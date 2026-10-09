// Creates one isolated HTTP conversation, then removes only that fixture.
// Real model usage remains charged; no browser or administrator settings changes.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const base = process.env.CHAT_SMOKE_BASE || 'http://localhost:8848';
const pool = new pg.Pool({ host: '127.0.0.1', port: Number(process.env.POSTGRES_PORT || 5433), user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD, database: process.env.POSTGRES_DB || 'grounded_support', connectionTimeoutMillis: 5000 });
let cookie = '', conversationId;
async function request(path, body, method = 'POST') {
  const response = await fetch(base + path, { method, headers: { Origin: new URL(base).origin,
    ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(90_000) });
  const issued = response.headers.getSetCookie().find(value => value.startsWith('grounded_visitor='));
  if (issued) cookie = issued.split(';')[0];
  return response;
}
async function trace(id) {
  const result = await pool.query('SELECT context_snapshot AS context FROM chat_traces WHERE id=$1 AND conversation_id=$2', [id, conversationId]);
  return result.rows[0].context;
}
try {
  const products = await fetch(base + '/api/products').then(response => response.json());
  const product = products.find(p => p.id === 'xiaomi-electric-warmer') || products[0];
  assert.ok(product?.id);
  const created = await request('/api/chat/conversations', undefined);
  assert.equal(created.status, 201);
  conversationId = (await created.json()).id;
  assert.ok(conversationId);
  const firstResponse = await request(`/api/chat/conversations/${conversationId}/messages`, { question: `请简要介绍${product.name}的参数和适用场景。`, context: { productIds: [product.id] } });
  const first = await firstResponse.json();
  assert.equal(firstResponse.status, 200, `First request failed: ${first.code ?? 'http_error'}`);
  assert.equal(first.refused, false);
  const firstTrace = await trace(first.traceId);
  assert.ok(firstTrace.runtimeContextBlocks.some(block => block.origin === 'preload' && block.resources.some(r => r.kind === 'product')));
  const evidenceIds = firstTrace.runtimeContextBlocks.flatMap(b => b.resources.filter(r => r.kind === 'knowledge').map(r => r.data.chunkId));
  assert.ok(evidenceIds.length, 'Fixture must retrieve evidence to verify RAG persistence');
  console.log(JSON.stringify({ round: 1, persistedBlocks: firstTrace.runtimeContextBlocks.length, persistedEvidenceCount: evidenceIds.length }));

  // No productIds and no context in the follow-up. This used to discard the preload.
  const secondResponse = await request(`/api/chat/conversations/${conversationId}/messages`, { question: '刚才这个产品的额定功率和适用面积是多少？' });
  const second = await secondResponse.json();
  assert.equal(secondResponse.status, 200, `Second request failed: ${second.code ?? 'http_error'}`);
  assert.equal(second.refused, false);
  const secondTrace = await trace(second.traceId);
  const firstPlanner = secondTrace.modelCalls.find(call => call.purpose === 'planner');
  const context = JSON.parse(firstPlanner.request.messages.at(-1).content);
  assert.deepEqual(context.productContext.productIds, []);
  assert.equal(context.productContext.products.filter(p => p.id === product.id).length, 1);
  assert.ok(evidenceIds.every(id => context.initialEvidence.some(hit => hit.chunkId === id)));
  assert.ok(secondTrace.contextMemory.restored >= 1 + new Set(evidenceIds).size);
  assert.ok(secondTrace.toolCalls.filter(call => call.name.includes('get_product_detail') && call.arguments.productId === product.id).every(call => call.reused));
  console.log(JSON.stringify({ round: 2, restored: secondTrace.contextMemory.restored,
    linkedProductIds: context.productContext.productIds, plannerCalls: secondTrace.modelCalls.filter(c => c.purpose === 'planner').length,
    physicalDetailRequeries: secondTrace.toolCalls.filter(c => c.name.includes('get_product_detail') && !c.reused).length, answered: !second.refused }));
} finally {
  if (conversationId && cookie) {
    const response = await request(`/api/chat/conversations/${conversationId}`, undefined, 'DELETE');
    assert.equal(response.status, 204, 'Remove only the isolated fixture conversation');
    console.log('Isolated fixture removed; model usage was not rolled back.');
  }
  await pool.end();
}
