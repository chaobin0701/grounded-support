import { readFile, readdir } from 'node:fs/promises';
import { adminSession } from './sample-admin-session.mjs';

const { baseUrl, token } = await adminSession();
const sourceDir = process.env.SAMPLE_KNOWLEDGE_DIR || '../samples/knowledge';
const names = (await readdir(sourceDir)).filter((name) => /^\d\d-.*\.md$/.test(name)).sort();
if (names.length === 0) throw new Error('No sample Markdown files found');
const headers = { Authorization: `Bearer ${token}` };
const listResponse = await fetch(new URL('/api/admin/documents?limit=100&offset=0', baseUrl), { headers });
if (!listResponse.ok) throw new Error(`Document list returned HTTP ${listResponse.status}`);
const existing = await listResponse.json();
if (!Array.isArray(existing)) throw new Error('Document list has an unexpected format');
const known = new Set(existing.filter((item) => !item.archivedAt).map((item) => item.originalFilename));

for (const name of names) {
  if (known.has(name)) {
    console.log(`${name}: already present`);
    continue;
  }
  const form = new FormData();
  form.set('file', new Blob([await readFile(`${sourceDir}/${name}`)], { type: 'text/markdown' }), name);
  const response = await fetch(new URL('/api/admin/documents', baseUrl), {
    method: 'POST', headers, body: form, signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`${name}: upload returned HTTP ${response.status}`);
  const document = await response.json();
  console.log(`${name}: uploaded as document ${document.id}`);
}

const deadline = Date.now() + 60_000;
while (Date.now() < deadline) {
  const response = await fetch(new URL('/api/admin/documents?limit=100&offset=0', baseUrl), { headers });
  if (!response.ok) throw new Error(`Document status returned HTTP ${response.status}`);
  const rows = await response.json();
  const selected = names.map((name) => rows.find((item) => item.originalFilename === name && !item.archivedAt));
  if (selected.every((item) => item?.status === 'ready')) {
    console.log(`Ready: ${selected.length}/${names.length}`);
    process.exit(0);
  }
  if (selected.some((item) => item?.status === 'failed')) {
    throw new Error('At least one sample document failed processing; inspect the admin document list');
  }
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
throw new Error('Timed out waiting for sample documents to become ready');
