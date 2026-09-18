import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { DatabaseService } from '../database.service';
import { DocumentQueueService } from './document-queue.service';
import { DOCUMENTS_DIR, documentPath } from './document-storage';

const MAX_BYTES = 2 * 1024 * 1024;

@Injectable()
export class DocumentService {
  constructor(private readonly database: DatabaseService, private readonly queue: DocumentQueueService) {}

  async upload(actorId: number, file: Express.Multer.File | undefined, rawTitle: string | undefined) {
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
    await mkdir(DOCUMENTS_DIR, { recursive: true });
    await writeFile(documentPath(storageKey), file.buffer, { flag: 'wx' });

    try {
      return await this.database.transaction(async (client) => {
        const created = await client.query<{ id: string; created_at: Date }>(
          `INSERT INTO documents (title, original_filename, storage_key, sha256, byte_size, uploaded_by)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, created_at`,
          [title, filename, storageKey, sha256, file.size, actorId],
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
        if (!found.rows[0]) await unlink(documentPath(storageKey));
      } catch {
        // Leave a possible orphan for later reconciliation rather than break a committed document.
      }
      throw error;
    }
  }

  async list(limit: number, offset: number) {
    const result = await this.database.query(
      `SELECT id::int, title, original_filename AS "originalFilename", byte_size AS "byteSize",
              uploaded_by::int AS "uploadedBy", status, error_message AS "errorMessage",
              archived_at AS "archivedAt", created_at AS "createdAt", updated_at AS "updatedAt"
       FROM documents ORDER BY id DESC LIMIT $1 OFFSET $2`, [limit, offset],
    );
    return result.rows;
  }

  async get(id: number) {
    const result = await this.database.query(
      `SELECT id::int, title, original_filename AS "originalFilename", sha256,
              byte_size AS "byteSize", uploaded_by::int AS "uploadedBy", status,
              extracted_text AS "extractedText", error_message AS "errorMessage",
              (SELECT count(*)::int FROM document_chunks WHERE document_id = documents.id) AS "chunkCount",
              archived_at AS "archivedAt", created_at AS "createdAt", updated_at AS "updatedAt"
       FROM documents WHERE id = $1`, [id],
    );
    if (!result.rows[0]) throw new NotFoundException('Document not found');
    return result.rows[0];
  }

  async archive(actorId: number, id: number) {
    return this.database.transaction(async (client) => {
      const result = await client.query<{ id: string }>(
        'UPDATE documents SET archived_at = now(), updated_at = now() WHERE id = $1 AND archived_at IS NULL RETURNING id', [id],
      );
      if (!result.rows[0]) throw new NotFoundException('Active document not found');
      await client.query(
        `INSERT INTO audit_logs (actor_admin_id, action, target_type, target_id)
         VALUES ($1, 'document.archived', 'document', $2)`, [actorId, String(id)],
      );
      return { id, archived: true };
    });
  }

  async retry(actorId: number, id: number) {
    return this.scheduleReprocess(actorId, id, true);
  }

  async reprocess(actorId: number, id: number) {
    return this.scheduleReprocess(actorId, id, false);
  }

  async listChunks(id: number) {
    await this.get(id);
    const result = await this.database.query(
      `SELECT id::int, ordinal, heading_path AS "headingPath", content,
              source_start_line AS "sourceStartLine", source_end_line AS "sourceEndLine"
       FROM document_chunks WHERE document_id = $1 ORDER BY ordinal`, [id],
    );
    return result.rows;
  }

  private async scheduleReprocess(actorId: number, id: number, onlyFailed: boolean) {
    return this.database.transaction(async (client) => {
      const row = await client.query<{ status: string; archived_at: Date | null }>(
        'SELECT status, archived_at FROM documents WHERE id = $1 FOR UPDATE', [id],
      );
      if (!row.rows[0]) throw new NotFoundException('Document not found');
      if (row.rows[0].archived_at || (onlyFailed
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
