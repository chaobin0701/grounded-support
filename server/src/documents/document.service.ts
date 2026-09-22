import { BadRequestException, ConflictException, Injectable, NotFoundException, StreamableFile } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile, readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { DatabaseService } from '../database.service';
import { DocumentQueueService } from './document-queue.service';
import { documentsDir, documentPath } from './document-storage';
import { AppConfigService } from '../config/config.service';

const MAX_BYTES = 2 * 1024 * 1024;

@Injectable()
export class DocumentService {
  constructor(private readonly database: DatabaseService, private readonly queue: DocumentQueueService, private readonly config: AppConfigService) {}

  async upload(actorId: number, file: Express.Multer.File | undefined, rawTitle: string | undefined, knowledgeBaseId?: number) {
    if (!file) throw new BadRequestException('A document file is required');
    const filename = basename(file.originalname).normalize('NFC');
    const extension = extname(filename).toLowerCase();
    if (!['.md', '.markdown', '.docx', '.pdf'].includes(extension)) {
      throw new BadRequestException('Only Markdown, DOCX, and PDF files are supported');
    }
    if (!filename || filename.length > 255 || file.size === 0 || file.size > MAX_BYTES) {
      throw new BadRequestException('Invalid filename or file size');
    }
    if (extension === '.md' || extension === '.markdown') {
      let content: string;
      try {
        content = new TextDecoder('utf-8', { fatal: true }).decode(file.buffer);
      } catch {
        throw new BadRequestException('Markdown file must be UTF-8 text');
      }
      if (!content.trim() || content.includes('\0')) throw new BadRequestException('Markdown content is empty or invalid');
    } else if (extension === '.pdf' && file.buffer.subarray(0, 5).toString() !== '%PDF-') {
      throw new BadRequestException('Invalid PDF file');
    } else if (extension === '.docx' && file.buffer.subarray(0, 4).toString('hex') !== '504b0304') {
      throw new BadRequestException('Invalid DOCX file');
    }

    const title = rawTitle?.trim() || filename.replace(/\.(md|markdown|docx|pdf)$/i, '');
    if (title.length > 200) throw new BadRequestException('Title is too long');
    const storageKey = `${randomUUID()}.${extension === '.markdown' ? 'md' : extension.slice(1)}`;
    const sha256 = createHash('sha256').update(file.buffer).digest('hex');
    await mkdir(documentsDir(this.config), { recursive: true });
    await writeFile(documentPath(storageKey, this.config), file.buffer, { flag: 'wx' });

    try {
      return await this.database.transaction(async (client) => {
        const base = await client.query<{ id: string }>(`SELECT id FROM knowledge_bases
          WHERE id = COALESCE($1::bigint, (SELECT id FROM knowledge_bases WHERE is_default))
          AND archived_at IS NULL FOR SHARE`, [knowledgeBaseId ?? null]);
        if (!base.rows[0]) throw new NotFoundException('Active knowledge base not found');
        const created = await client.query<{ id: string; created_at: Date }>(
          `INSERT INTO documents (title, original_filename, storage_key, sha256, byte_size, uploaded_by, knowledge_base_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, created_at`,
          [title, filename, storageKey, sha256, file.size, actorId, base.rows[0].id],
        );
        const id = Number(created.rows[0].id);
        await this.queue.enqueue(client, id);
        await client.query(
          `INSERT INTO audit_logs (actor_admin_id, action, target_type, target_id, details)
           VALUES ($1, 'document.uploaded', 'document', $2, $3)`,
          [actorId, String(id), JSON.stringify({ filename, byteSize: file.size })],
        );
        return { id, title, originalFilename: filename, status: 'queued', createdAt: created.rows[0].created_at };
      });
    } catch (error) {
      // A lost connection during COMMIT is ambiguous: the row may already exist.
      // Keep the file if we cannot prove the transaction rolled back.
      try {
        const found = await this.database.query('SELECT 1 FROM documents WHERE storage_key = $1', [storageKey]);
        if (!found.rows[0]) await unlink(documentPath(storageKey, this.config));
      } catch {
        // Leave a possible orphan for later reconciliation rather than break a committed document.
      }
      throw error;
    }
  }

  async list(limit: number, offset: number, knowledgeBaseId?: number) {
    const result = await this.database.query(
      `SELECT id::int, title, original_filename AS "originalFilename", byte_size AS "byteSize",
              uploaded_by::int AS "uploadedBy", status, error_message AS "errorMessage",
              parser_version AS "parserVersion", source_type AS "sourceType",
              archived_at AS "archivedAt", created_at AS "createdAt", updated_at AS "updatedAt"
       FROM documents WHERE knowledge_base_id = COALESCE($3::bigint, (SELECT id FROM knowledge_bases WHERE is_default))
       ORDER BY id DESC LIMIT $1 OFFSET $2`, [limit, offset, knowledgeBaseId ?? null],
    );
    return result.rows;
  }

  async get(id: number, knowledgeBaseId?: number) {
    const result = await this.database.query(
      `SELECT id::int, title, original_filename AS "originalFilename", sha256,
              byte_size AS "byteSize", uploaded_by::int AS "uploadedBy", status,
              extracted_text AS "extractedText", error_message AS "errorMessage",
              (SELECT count(*)::int FROM document_chunks WHERE document_id = documents.id) AS "chunkCount",
              archived_at AS "archivedAt", created_at AS "createdAt", updated_at AS "updatedAt"
       FROM documents WHERE id = $1 AND knowledge_base_id = COALESCE($2::bigint, (SELECT id FROM knowledge_bases WHERE is_default))`, [id, knowledgeBaseId ?? null],
    );
    if (!result.rows[0]) throw new NotFoundException('Document not found');
    return result.rows[0];
  }

  async download(id: number, knowledgeBaseId: number) {
    const result = await this.database.query<{ storage_key: string; original_filename: string }>(
      `SELECT storage_key,original_filename FROM documents WHERE id=$1 AND knowledge_base_id=$2 AND source_type='file'`, [id,knowledgeBaseId]);
    const row = result.rows[0];
    if (!row) throw new NotFoundException('Original file not found');
    let bytes: Buffer;
    try { bytes=await readFile(documentPath(row.storage_key,this.config)); }
    catch { throw new NotFoundException('Original file unavailable'); }
    return new StreamableFile(bytes, { type:'application/octet-stream',
      disposition:`attachment; filename*=UTF-8''${encodeURIComponent(row.original_filename).replace(/'/g,'%27')}` });
  }

  async archive(actorId: number, id: number, knowledgeBaseId?: number) {
    return this.database.transaction(async (client) => {
      const result = await client.query<{ id: string }>(
        `UPDATE documents SET archived_at = now(), updated_at = now() WHERE id = $1 AND archived_at IS NULL
         AND knowledge_base_id = COALESCE($2::bigint, (SELECT id FROM knowledge_bases WHERE is_default)) RETURNING id`, [id, knowledgeBaseId ?? null],
      );
      if (!result.rows[0]) throw new NotFoundException('Active document not found');
      await client.query(
        `INSERT INTO audit_logs (actor_admin_id, action, target_type, target_id)
         VALUES ($1, 'document.archived', 'document', $2)`, [actorId, String(id)],
      );
      return { id, archived: true };
    });
  }

  async retry(actorId: number, id: number, knowledgeBaseId?: number) {
    return this.scheduleReprocess(actorId, id, true, knowledgeBaseId);
  }

  async reprocess(actorId: number, id: number, knowledgeBaseId?: number) {
    return this.scheduleReprocess(actorId, id, false, knowledgeBaseId);
  }

  async reprocessAll(actorId: number, knowledgeBaseId: number) {
    return this.database.transaction(async (client) => {
      const base = await client.query(`SELECT id FROM knowledge_bases WHERE id=$1 AND archived_at IS NULL FOR SHARE`, [knowledgeBaseId]);
      if (!base.rowCount) throw new NotFoundException('Active knowledge base not found');
      const queued = await client.query<{ id: number }>(`UPDATE documents AS document
        SET status='queued', error_message=NULL, updated_at=now()
        WHERE knowledge_base_id=$1 AND archived_at IS NULL AND source_type='file'
          AND status IN ('ready','failed','extracted')
          AND (status = 'failed' OR NOT EXISTS (
            SELECT 1 FROM document_blocks AS block WHERE block.document_id = document.id
          ))
        RETURNING id::int`, [knowledgeBaseId]);
      for (const document of queued.rows) await this.queue.enqueue(client, document.id);
      await client.query(`INSERT INTO audit_logs(actor_admin_id,action,target_type,target_id,details)
        VALUES($1,'document.reprocess_all','knowledge_base',$2,$3)`, [actorId,String(knowledgeBaseId),JSON.stringify({ count: queued.rows.length })]);
      return { queued: queued.rows.length };
    });
  }

  async listChunks(id: number, knowledgeBaseId?: number) {
    await this.get(id, knowledgeBaseId);
    const result = await this.database.query(
      `SELECT id::int, ordinal, heading_path AS "headingPath", content,
              source_start_line AS "sourceStartLine", source_end_line AS "sourceEndLine"
       FROM document_chunks WHERE document_id = $1 ORDER BY ordinal`, [id],
    );
    return result.rows;
  }

  private async scheduleReprocess(actorId: number, id: number, onlyFailed: boolean, knowledgeBaseId?: number) {
    return this.database.transaction(async (client) => {
      const row = await client.query<{ status: string; archived_at: Date | null; source_type: string }>(
        `SELECT status, archived_at, source_type FROM documents WHERE id = $1
         AND knowledge_base_id = COALESCE($2::bigint, (SELECT id FROM knowledge_bases WHERE is_default)) FOR UPDATE`, [id, knowledgeBaseId ?? null],
      );
      if (!row.rows[0]) throw new NotFoundException('Document not found');
      if (row.rows[0].source_type === 'faq' || row.rows[0].archived_at || (onlyFailed
        ? row.rows[0].status !== 'failed'
        : !['failed', 'extracted', 'ready'].includes(row.rows[0].status))) {
        throw new ConflictException('Document cannot be reprocessed in its current state');
      }
      await client.query(
        "UPDATE documents SET status = 'queued', error_message = NULL, updated_at = now() WHERE id = $1", [id],
      );
      await this.queue.enqueue(client, id);
      await client.query(
        `INSERT INTO audit_logs (actor_admin_id, action, target_type, target_id)
         VALUES ($1, $2, 'document', $3)`, [actorId, onlyFailed ? 'document.retried' : 'document.reprocessed', String(id)],
      );
      return { id, status: 'queued' };
    });
  }
}
