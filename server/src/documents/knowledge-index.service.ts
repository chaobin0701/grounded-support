import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { DatabaseService } from '../database.service';
import { DocumentQueueService } from './document-queue.service';
import { buildChunks } from './build-chunks';
import { documentBlockSchema, knowledgeConfigSchema } from './knowledge-config';

export const indexInputSchema = z.array(z.object({
  documentId: z.number().int().positive(),
  documentTitle: z.string(), originalFilename: z.string(),
  blocks: z.array(documentBlockSchema).min(1),
})).min(1);

@Injectable()
export class KnowledgeIndexService {
  constructor(private readonly database: DatabaseService, private readonly queue: DocumentQueueService) {}

  async configure(actorId: number, id: number, input: unknown) {
    const parsed = knowledgeConfigSchema.safeParse(input);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues.map((v) => v.message).join('; '));
    return this.database.transaction(async (client) => {
      const updated = await client.query(`UPDATE knowledge_bases SET draft_config = $2, updated_at = now()
        WHERE id = $1 AND archived_at IS NULL RETURNING draft_config`, [id, JSON.stringify(parsed.data)]);
      if (!updated.rowCount) throw new NotFoundException('Active knowledge base not found');
      await client.query(`INSERT INTO audit_logs (actor_admin_id,action,target_type,target_id)
        VALUES ($1,'knowledge_base.configured','knowledge_base',$2)`, [actorId, String(id)]);
      return parsed.data;
    });
  }

  async preview(id: number, documentId: number) {
    const result = await this.database.query(`SELECT kb.draft_config, b.ordinal, b.block_type AS "blockType",
      b.heading_path AS "headingPath", b.content, b.source_locator AS "sourceLocator"
      FROM knowledge_bases kb JOIN documents d ON d.knowledge_base_id = kb.id
      JOIN document_blocks b ON b.document_id = d.id
      WHERE kb.id = $1 AND d.id = $2 AND kb.archived_at IS NULL AND d.archived_at IS NULL ORDER BY b.ordinal`, [id, documentId]);
    if (!result.rows.length) throw new NotFoundException('Parsed document not found; reprocess legacy documents first');
    const blocks = result.rows.map(({ draft_config, ...block }) => documentBlockSchema.parse(block));
    return buildChunks(blocks, knowledgeConfigSchema.parse(result.rows[0].draft_config));
  }

  async blocks(id: number, documentId: number) {
    const document = (await this.database.query(`SELECT parser_version AS "parserVersion",parser_warnings AS warnings
      FROM documents WHERE id=$1 AND knowledge_base_id=$2 AND archived_at IS NULL`, [documentId,id])).rows[0];
    if (!document) throw new NotFoundException('Document not found');
    const blocks = (await this.database.query(`SELECT ordinal,block_type AS "blockType",heading_path AS "headingPath",
      content,source_locator AS "sourceLocator" FROM document_blocks WHERE document_id=$1 ORDER BY ordinal`, [documentId])).rows;
    return { ...document, blocks };
  }

  async versions(id: number) {
    return (await this.database.query(`SELECT id::int, status, config, chunk_count AS "chunkCount",
      error_message AS "errorMessage", created_at AS "createdAt", finished_at AS "finishedAt"
      FROM knowledge_index_versions WHERE knowledge_base_id = $1 ORDER BY id DESC`, [id])).rows;
  }

  async build(actorId: number, id: number) {
    return this.database.transaction(async (client) => {
      const kb = (await client.query('SELECT draft_config FROM knowledge_bases WHERE id=$1 AND archived_at IS NULL FOR UPDATE', [id])).rows[0];
      if (!kb) throw new NotFoundException('Active knowledge base not found');
      if ((await client.query("SELECT id FROM knowledge_index_versions WHERE knowledge_base_id=$1 AND status='building'", [id])).rowCount) {
        throw new ConflictException('A build is already queued or running');
      }
      const config = knowledgeConfigSchema.parse(kb.draft_config);
      // A single statement freezes every parsed document and block in one MVCC snapshot.
      const inputs = (await client.query(`SELECT d.id::int AS "documentId", d.status,
        d.title AS "documentTitle", d.original_filename AS "originalFilename",
        COALESCE(jsonb_agg(jsonb_build_object('ordinal',b.ordinal,'blockType',b.block_type,
          'headingPath',b.heading_path,'content',b.content,'sourceLocator',b.source_locator)
          ORDER BY b.ordinal) FILTER (WHERE b.id IS NOT NULL),'[]') AS blocks
        FROM documents d LEFT JOIN document_blocks b ON b.document_id=d.id
        WHERE d.knowledge_base_id=$1 AND d.archived_at IS NULL GROUP BY d.id ORDER BY d.id`, [id])).rows;
      const incomplete = inputs.filter((row) => row.status !== 'ready' || !Array.isArray(row.blocks) || !row.blocks.length);
      if (!inputs.length) throw new ConflictException('Add a document or FAQ before building an index');
      if (incomplete.length) {
        throw new ConflictException(`${incomplete.length} active document(s) are not prepared. Wait for processing or use “reprocess all” for legacy documents.`);
      }
      const snapshot = indexInputSchema.parse(inputs.map(({ status, ...input }) => input));
      let profile: unknown = null;
      if (config.indexMode === 'high_quality') {
        profile = (await client.query('SELECT config FROM embedding_profiles WHERE id=$1 AND enabled', [config.embeddingProfileId])).rows[0]?.config;
        if (!profile) throw new BadRequestException('Enabled embedding profile required');
      }
      const version = (await client.query(`INSERT INTO knowledge_index_versions
        (knowledge_base_id,status,config,embedding_snapshot,input_snapshot,created_by)
        VALUES ($1,'building',$2,$3,$4,$5) RETURNING id::int`,
      [id, JSON.stringify(config), profile === null ? null : JSON.stringify(profile), JSON.stringify(snapshot), actorId])).rows[0];
      await this.queue.enqueueIndex(client, version.id);
      await client.query(`INSERT INTO audit_logs (actor_admin_id,action,target_type,target_id)
        VALUES ($1,'knowledge_index.build_requested','knowledge_index',$2)`, [actorId, String(version.id)]);
      return version;
    });
  }

  async activate(actorId: number, id: number, versionId: number) {
    return this.database.transaction(async (client) => {
      const result = await client.query(`UPDATE knowledge_bases kb SET active_index_version_id=v.id, enabled_for_chat=true, updated_at=now()
        FROM knowledge_index_versions v WHERE kb.id=$1 AND kb.archived_at IS NULL
        AND v.id=$2 AND v.knowledge_base_id=kb.id AND v.status='ready' RETURNING kb.id::int`, [id, versionId]);
      if (!result.rowCount) throw new ConflictException('Only a ready version belonging to an active knowledge base can be activated');
      await client.query(`INSERT INTO audit_logs (actor_admin_id,action,target_type,target_id,details)
        VALUES ($1,'knowledge_index.activated','knowledge_base',$2,$3)`, [actorId, String(id), JSON.stringify({ versionId })]);
      return { id, activeIndexVersionId: versionId };
    });
  }
}
