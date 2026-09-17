import { readdir } from 'node:fs/promises';
import { adminSession } from './sample-admin-session.mjs';

const { baseUrl, token } = await adminSession();
const sourceDir = process.env.SAMPLE_KNOWLEDGE_DIR || '../samples/knowledge';
const names = (await readdir(sourceDir)).filter((name) => /^\d\d-.*\.md$/.test(name)).sort();
if (names.length === 0) throw new Error('No sample Markdown files found');
const headers = { Authorization: `Bearer ${token}` };

async function listDocuments() {
  const response = await fetch(new URL('/api/admin/documents?limit=100&offset=0', baseUrl), {
    headers, signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Document list returned HTTP ${response.status}`);
  const rows = await response.json();
  if (!Array.isArray(rows)) throw new Error('Document list has an unexpected format');
  return rows;
}

const rows = await listDocuments();
const selected = names.map((name) => rows.find((item) => item.originalFilename === name && !item.archivedAt));
if (selected.some((item) => !item)) throw new Error('Upload all sample documents before reprocessing');
for (const document of selected) {
  const response = await fetch(new URL(`/api/admin/documents/${document.id}/reprocess`, baseUrl), {
    method: 'POST', headers, signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Document ${document.id}: reprocess returned HTTP ${response.status}`);
  console.log(`Document ${document.id}: queued for embedding`);
}

const deadline = Date.now() + 180_000;
while (Date.now() < deadline) {
  const latest = await listDocuments();
  const current = selected.map((item) => latest.find((row) => row.id === item.id));
  if (current.some((item) => item?.status === 'failed')) {
    throw new Error('At least one document failed reprocessing; inspect the admin document list and worker logs');
  }
  if (current.every((item) => item?.status === 'ready')) {
    const url = new URL('/api/admin/search', baseUrl);
    url.searchParams.set('q', '退款到账');
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`Search check returned HTTP ${response.status}`);
    const result = await response.json();
    if (result.vectorIndexedChunks === 0) {
      throw new Error('Documents are ready but have no vectors; configure the embedding service for both API and Worker');
    }
    console.log(`Ready: ${current.length}/${selected.length}; vectorized chunks: ${result.vectorIndexedChunks}`);
    process.exit(0);
  }
  await new Promise((resolve) => setTimeout(resolve, 2000));
}
throw new Error('Timed out waiting for sample documents to become ready');
