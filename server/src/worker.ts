import 'reflect-metadata';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { PgBoss } from 'pg-boss';
import { DOCUMENT_INGEST_QUEUE, KNOWLEDGE_INDEX_QUEUE } from './documents/document-queue.service';
import { buildKnowledgeIndex } from './documents/build-knowledge-index';
import { documentPath } from './documents/document-storage';
import { EmbeddingService } from './documents/embedding.service';
import { parseDocument, ScannedPdfError } from './documents/extract-document';
import { AppConfigService } from './config/config.service';
import { DOCUMENT_PARSER_VERSION } from './documents/document-block';

type DocumentJob = { documentId: number };
const runtimeConfig = new AppConfigService();
const embeddings = new EmbeddingService(runtimeConfig);

async function processDocument(pool: Pool, documentId: number): Promise<void> {
  if (!Number.isSafeInteger(documentId) || documentId <= 0) throw new Error('Invalid document ID');
  const claimed = await pool.query<{ storage_key: string; sha256: string; byte_size: number; legacy: boolean }>(
    `UPDATE documents SET status = 'processing', error_message = NULL, updated_at = now()
     WHERE id = $1 AND archived_at IS NULL AND source_type='file' AND status IN ('queued', 'failed', 'extracted', 'processing')
     RETURNING storage_key, sha256, byte_size,
       (SELECT kb.is_default AND kb.active_index_version_id IS NULL AND kb.draft_config = '{}'::jsonb
        FROM knowledge_bases kb WHERE kb.id=documents.knowledge_base_id) AS legacy`, [documentId],
  );
  const document = claimed.rows[0];
  if (!document) return;

  try {
    const bytes = await readFile(documentPath(document.storage_key, runtimeConfig));
    if (bytes.length !== document.byte_size || createHash('sha256').update(bytes).digest('hex') !== document.sha256) {
      throw new Error('Stored file failed integrity check');
    }
    const parsed = await parseDocument(bytes, document.storage_key);
    const vectors = document.legacy && embeddings.enabled
      ? await embeddings.embed(parsed.chunks.map((chunk) => `${chunk.headingPath}\n${chunk.content}`))
      : [];

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const current = await client.query<{ status: string; archived_at: Date | null }>(
        'SELECT status, archived_at FROM documents WHERE id = $1 FOR UPDATE', [documentId],
      );
      if (!current.rows[0] || current.rows[0].archived_at || current.rows[0].status !== 'processing') {
        await client.query('COMMIT');
        return;
      }
      await client.query('DELETE FROM document_chunks WHERE document_id = $1', [documentId]);
      await client.query('DELETE FROM document_blocks WHERE document_id = $1', [documentId]);
      await client.query(`INSERT INTO document_blocks
        (document_id, ordinal, block_type, heading_path, content, source_locator)
        SELECT $1, x.ordinal, x."blockType", x."headingPath", x.content, x."sourceLocator"
        FROM jsonb_to_recordset($2::jsonb) AS x(ordinal integer, "blockType" text,
          "headingPath" text, content text, "sourceLocator" jsonb)`, [documentId, JSON.stringify(parsed.blocks)]);
      await client.query(
        `INSERT INTO document_chunks
           (document_id, ordinal, heading_path, content, source_start_line, source_end_line, embedding, embedding_model)
         SELECT $1, x.ordinal, x."headingPath", x.content, x."sourceStartLine", x."sourceEndLine",
                x.embedding::vector, x."embeddingModel"
         FROM jsonb_to_recordset($2::jsonb) AS x(
           ordinal integer, "headingPath" text, content text,
           "sourceStartLine" integer, "sourceEndLine" integer,
           embedding text, "embeddingModel" text)`,
        [documentId, JSON.stringify(parsed.chunks.map((chunk, index) => ({
          ...chunk,
          embedding: vectors[index] ? `[${vectors[index].join(',')}]` : null,
          embeddingModel: vectors[index] ? embeddings.model : null,
        })))],
      );
      await client.query(
        `UPDATE documents SET extracted_text = $1, status = 'ready', error_message = NULL,
                parser_version = $3, parser_warnings=$4, updated_at = now() WHERE id = $2`,
        [parsed.extractedText, documentId, DOCUMENT_PARSER_VERSION, JSON.stringify(parsed.warnings ?? [])],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    await pool.query(
      `UPDATE documents SET status = 'failed', error_message = $2, updated_at = now()
       WHERE id = $1 AND archived_at IS NULL AND status = 'processing'`,
      [documentId, error instanceof ScannedPdfError ? error.message : 'Unable to process document'],
    );
    throw error;
  }
}

async function bootstrap(): Promise<void> {
  const connectionString = runtimeConfig.databaseUrl;
  if (!connectionString) throw new Error('DATABASE_URL is required');

  const boss = new PgBoss(connectionString);
  const pool = new Pool({ connectionString });
  boss.on('error', (error) => console.error('Worker queue error:', error));
  await boss.start();
  await boss.createQueue(DOCUMENT_INGEST_QUEUE);
  await boss.createQueue(KNOWLEDGE_INDEX_QUEUE);
  await boss.work<{ versionId: number }>(KNOWLEDGE_INDEX_QUEUE, async ([job]) => {
    await buildKnowledgeIndex(pool, job.data.versionId, runtimeConfig);
  });
  await boss.work<DocumentJob>(DOCUMENT_INGEST_QUEUE, async ([job]) => {
    const lock = await pool.connect();
    try {
      const acquired = await lock.query<{ locked: boolean }>('SELECT pg_try_advisory_lock(73192,$1::int) AS locked', [job.data.documentId]);
      if (!acquired.rows[0].locked) throw new Error('Document processing is already running');
      // A retried job can reclaim processing after a worker crash, but never run concurrently.
      try { await processDocument(pool, job.data.documentId); }
      finally { await lock.query('SELECT pg_advisory_unlock(73192,$1::int)', [job.data.documentId]); }
    } finally { lock.release(); }
  });
  console.log(`Worker ready for document extraction and chunking; embeddings ${embeddings.enabled ? 'enabled' : 'disabled'}.`);

  const shutdown = async (): Promise<void> => {
    await boss.stop();
    await pool.end();
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
}

void bootstrap();
