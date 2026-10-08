import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const require = createRequire(new URL('../server/package.json', import.meta.url));
const { Pool } = require('pg');
const uploadDirectory = fileURLToPath(new URL('../.data/uploads/documents/', import.meta.url));
const targets = [
  { id: 42, filename: '品牌介绍.md' },
  { id: 43, filename: '服务支持与常见问题.md' },
  { id: 44, filename: '产品选购与规格说明.md' },
  { id: 45, filename: '关于我们.md' },
  { id: 46, filename: '品牌历史.md' },
];
const pool = new Pool({ host: '127.0.0.1', port: Number(process.env.POSTGRES_PORT || 5433), user: process.env.POSTGRES_USER, password: process.env.POSTGRES_PASSWORD, database: process.env.POSTGRES_DB });
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const apply = process.argv.includes('--apply');
const client = await pool.connect();
try {
  await client.query('BEGIN');
  const { rows } = await client.query(`SELECT id::int, title, original_filename, sha256, byte_size, storage_key, uploaded_by::int, status, parser_version, extracted_text,
    (SELECT count(*) FROM document_chunks WHERE document_id=documents.id) AS chunks,
    (SELECT count(*) FROM document_blocks WHERE document_id=documents.id) AS blocks
    FROM documents WHERE id=ANY($1::bigint[]) AND knowledge_base_id=5 AND source_type='file' FOR UPDATE`, [targets.map(target => target.id)]);
  assert.equal(rows.length, targets.length, 'Exact document targets must all exist in the expected base');
  const plan = [];
  for (const target of targets) {
    const row = rows.find(row => row.id === target.id);
    assert.equal(row.status, 'ready', 'Do not race an active parser');
    assert.match(row.storage_key, /^[a-f0-9-]{36}\.md$/u);
    const downloaded = await readFile('/Users/ccb/Downloads/' + target.filename);
    const stored = await readFile(join(uploadDirectory, row.storage_key));
    assert.equal(row.sha256, digest(downloaded), 'Downloaded document must match the uploaded content hash');
    assert.equal(row.sha256, digest(stored), 'Stored original must match the same content hash');
    assert.equal(Number(row.byte_size), downloaded.length);
    const mojibake = Buffer.from(target.filename, 'utf8').toString('latin1').normalize('NFC');
    assert.ok([mojibake, target.filename].includes(row.original_filename), 'Do not overwrite an unrelated filename');
    // Preserve any independently edited title rather than deriving all titles again.
    const title = row.title === mojibake.replace(/\.md$/u, '') ? target.filename.replace(/\.md$/u, '') : row.title;
    plan.push({ id: row.id, beforeTitle: row.title, title, beforeFilename: row.original_filename, filename: target.filename, actorId: row.uploaded_by });
  }
  // These five documents currently have no version snapshots. Stop if that has
  // changed, rather than silently leaving versioned citation metadata stale.
  const snapshots = await client.query(`SELECT id FROM knowledge_index_versions WHERE EXISTS (
    SELECT 1 FROM jsonb_array_elements(input_snapshot) AS input WHERE (input->>'documentId')::bigint=ANY($1::bigint[]))`, [targets.map(target => target.id)]);
  assert.equal(snapshots.rows.length, 0, 'Versioned metadata requires a separate scoped repair');
  const indexed = await client.query('SELECT id FROM index_chunks WHERE document_id=ANY($1::bigint[])', [targets.map(target => target.id)]);
  assert.equal(indexed.rows.length, 0);
  let repaired = 0;
  for (const change of plan) {
    if (!apply || (change.beforeTitle === change.title && change.beforeFilename === change.filename)) continue;
    const result = await client.query(`UPDATE documents SET title=$2, original_filename=$3, updated_at=now()
      WHERE id=$1 AND title=$4 AND original_filename=$5 RETURNING id`, [change.id, change.title, change.filename, change.beforeTitle, change.beforeFilename]);
    assert.equal(result.rowCount, 1);
    await client.query(`INSERT INTO audit_logs(actor_admin_id,action,target_type,target_id,details)
      VALUES($1,'document.filename_repaired','document',$2,$3)`, [change.actorId, String(change.id), JSON.stringify({ reason: 'UTF-8 multipart filename was decoded as Latin-1', before: { title: change.beforeTitle, originalFilename: change.beforeFilename }, after: { title: change.title, originalFilename: change.filename }, contentHashVerified: true })]);
    repaired++;
  }
  const after = (await client.query('SELECT id::int,sha256,byte_size,storage_key,status,parser_version,extracted_text FROM documents WHERE id=ANY($1::bigint[])', [targets.map(target => target.id)])).rows;
  for (const original of rows) {
    const current = after.find(row => row.id === original.id);
    for (const key of ['sha256', 'byte_size', 'storage_key', 'status', 'parser_version', 'extracted_text']) assert.equal(current[key], original[key]);
  }
  await client.query(apply ? 'COMMIT' : 'ROLLBACK');
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', repaired, documents: plan.map(({ id, title, filename }) => ({ id, title, filename })), originalsAndParsedContentPreserved: true }));
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally { client.release(); await pool.end(); }
