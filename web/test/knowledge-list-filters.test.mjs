import assert from 'node:assert/strict';
import test from 'node:test';
import { filterKnowledgeBases, filterKnowledgeDocuments } from '../src/knowledge-list-filters.ts';

const archiveDate = '2026-10-08T00:00:00Z';
const records = [
  { id: 1, archivedAt: null, updatedAt: '2026-10-02T00:00:00Z' },
  { id: 2, archivedAt: null, updatedAt: '2026-10-03T00:00:00Z' },
  { id: 3, archivedAt: archiveDate, updatedAt: archiveDate },
];
const bases = records.map(item => ({ ...item, name: `KB ${item.id}`, description: '售后资料', enabledForChat: item.id === 1 }));
const documents = records.map(item => ({ ...item, title: `Doc ${item.id}`, originalFilename: `guide-${item.id}.pdf`, status: item.id === 2 ? 'failed' : 'ready', sourceType: 'file' }));

test('base and document lists hide archived records by default, even when all statuses are selected', () => {
  assert.deepEqual(filterKnowledgeBases(bases, '', 'all').map(item => item.id), [2, 1]);
  assert.deepEqual(filterKnowledgeDocuments(documents, '', 'all').map(item => item.id), [2, 1]);
  assert.deepEqual(filterKnowledgeBases(bases, 'KB 3', 'all'), []);
  assert.deepEqual(filterKnowledgeDocuments(documents, 'guide-3', 'all'), []);
});
test('show-archived is inclusive and always keeps archived records at the end', () => {
  assert.deepEqual(filterKnowledgeBases(bases, '', 'all', true).map(item => item.id), [2, 1, 3]);
  assert.deepEqual(filterKnowledgeDocuments(documents, '', 'all', true).map(item => item.id), [2, 1, 3]);
  assert.deepEqual(bases.map(item => item.id), [1, 2, 3], 'filters must not mutate source arrays');
});
test('archive visibility composes with status and case-insensitive name/description/file search', () => {
  assert.deepEqual(filterKnowledgeBases(bases, '售后', 'enabled', true).map(item => item.id), [1]);
  assert.deepEqual(filterKnowledgeBases(bases, ' kb ', 'disabled', true).map(item => item.id), [2, 3]);
  assert.deepEqual(filterKnowledgeDocuments(documents, 'GUIDE-', 'ready', true).map(item => item.id), [1, 3]);
  assert.deepEqual(filterKnowledgeDocuments(documents, ' doc ', 'failed', true).map(item => item.id), [2]);
});
test('hiding archives never hides active records and enabling it never brings FAQ items back', () => {
  const faq = { ...documents[0], id: 99, sourceType: 'faq' };
  assert.deepEqual(filterKnowledgeDocuments([...documents, faq], '', 'all', true).map(item => item.id), [2, 1, 3]);
  assert.deepEqual(filterKnowledgeDocuments([...documents, faq], '', 'all', false).map(item => item.id), [2, 1]);
});
test('processing filter includes pending, queued, processing and extracted documents', () => {
  const pending = ['pending', 'queued', 'processing', 'extracted'].map((status, index) => ({ ...documents[0], id: index + 10, status }));
  assert.equal(filterKnowledgeDocuments([...documents, ...pending], '', 'processing').length, 4);
});
test('archive-only data produces an empty active list until the archive toggle is enabled', () => {
  assert.equal(filterKnowledgeBases([bases[2]], '', 'all').length, 0);
  assert.equal(filterKnowledgeDocuments([documents[2]], '', 'all').length, 0);
  assert.equal(filterKnowledgeBases([bases[2]], '', 'all', true).length, 1);
  assert.equal(filterKnowledgeDocuments([documents[2]], '', 'all', true).length, 1);
});
