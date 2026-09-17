import 'reflect-metadata';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { PgBoss } from 'pg-boss';
import { DOCUMENT_INGEST_QUEUE } from './documents/document-queue.service';
import { documentPath } from './documents/document-storage';
import { parseMarkdownDocument } from './documents/extract-markdown';

type DocumentJob = { documentId: number };

async function processDocument(pool: Pool, documentId: number): Promise<void> {
  if (!Number.isSafeInteger(documentId) || documentId <= 0) throw new Error('Invalid document ID');
  const current = await pool.query<{ status: string; archived_at: Date | null }>(
    'SELECT status, archived_at FROM documents WHERE id = $1', [documentId],
  );
  if (!current.rows[0] || current.rows[0].archived_at || current.rows[0].status === 'ready') return;
  await pool.query(
    `UPDATE documents SET status = 'processing', error_message = NULL, updated_at = now()
     WHERE id = $1 AND archived_at IS NULL AND status <> 'ready'`, [documentId],
  );

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query<{ storage_key: string; sha256: string; byte_size: number; status: string; archived_at: Date | null }>(
      'SELECT storage_key, sha256, byte_size, status, archived_at FROM documents WHERE id = $1 FOR UPDATE', [documentId],
    );
    const document = result.rows[0];
    if (document && !document.archived_at && document.status !== 'ready') {
      const bytes = await readFile(documentPath(document.storage_key));
      if (bytes.length !== document.byte_size || createHash('sha256').update(bytes).digest('hex') !== document.sha256) {
        throw new Error('Stored file failed integrity check');
      }
      const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      const parsed = parseMarkdownDocument(source);
      if (!parsed.extractedText || parsed.chunks.length === 0) throw new Error('No readable Markdown text');
      await client.query('DELETE FROM document_chunks WHERE document_id = $1', [documentId]);
      await client.query(
        `INSERT INTO document_chunks
           (document_id, ordinal, heading_path, content, source_start_line, source_end_line)
         SELECT $1, x.ordinal, x."headingPath", x.content, x."sourceStartLine", x."sourceEndLine"
         FROM jsonb_to_recordset($2::jsonb) AS x(
           ordinal integer, "headingPath" text, content text,
           "sourceStartLine" integer, "sourceEndLine" integer)`,
        [documentId, JSON.stringify(parsed.chunks)],
      );
      await client.query(
        `UPDATE documents SET extracted_text = $1, status = 'ready', error_message = NULL,
                updated_at = now() WHERE id = $2`, [parsed.extractedText, documentId],
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    await pool.query(
      `UPDATE documents SET status = 'failed', error_message = 'Unable to extract Markdown text', updated_at = now()
       WHERE id = $1 AND archived_at IS NULL AND status <> 'ready'`, [documentId],
    );
    throw error;
  } finally {
    client.release();
  }
}

async function bootstrap(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required');

  const boss = new PgBoss(connectionString);
  const pool = new Pool({ connectionString });
  boss.on('error', (error) => console.error('Worker queue error:', error));
  await boss.start();
  await boss.createQueue(DOCUMENT_INGEST_QUEUE);
  await boss.work<DocumentJob>(DOCUMENT_INGEST_QUEUE, async ([job]) => {
    await processDocument(pool, job.data.documentId);
  });
  console.log('Worker ready for Markdown extraction and chunking.');

  const shutdown = async (): Promise<void> => {
    await boss.stop();
    await pool.end();
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
}

void bootstrap();
