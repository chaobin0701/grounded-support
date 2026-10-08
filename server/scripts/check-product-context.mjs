// HTTP-only smoke test: two real model requests, private visitor, no browser or admin configuration changes.
// Only the conversation created by this script is removed; quota accounting remains truthful.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const base = process.env.CHAT_SMOKE_BASE || 'http://localhost:8848';
const origin = new URL(base).origin;
const pool = new pg.Pool({ host: '127.0.0.1', port: 5433, user: process.env.POSTGRES_USER, password: process.env.POSTGRES_PASSWORD, database: process.env.POSTGRES_DB || 'grounded_support', connectionTimeoutMillis: 5000 });
let cookie = '', conversationId;
async function request(path, body, method = 'POST', key = randomUUID()) {
  const response = await fetch(base + path, {
    method, headers: { Origin: origin, ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json', 'Idempotency-Key': key } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(90_000),
  });
  const issued = response.headers.getSetCookie().find(value => value.startsWith('grounded_visitor='));
  if (issued) cookie = issued.split(';')[0];
  return response;
}
try {
  const catalog = await fetch(base + '/api/products').then(r => r.json());
  const product = catalog.find(p => p.id === 'xiaomi-electric-warmer') || catalog[0];
  assert.ok(product?.id);
  const text = '这个产品怎么样\n';
  const body = { question: text + product.name, context: { productIds: [product.id, product.id], productReferences: [{ productId: product.id, offset: text.length, length: product.name.length }] } };
  for (let round = 1; round <= 2; round++) {
    const response = await request(conversationId ? `/api/chat/conversations/${conversationId}/messages` : '/api/chat', body);
    assert.equal(response.status, 200, `round ${round}: HTTP ${response.status}`);
    const result = await response.json();
    conversationId = result.conversationId;
    assert.ok(result.traceId); assert.equal(result.refused, false);
    const trace = (await pool.query('SELECT context_snapshot AS context FROM chat_traces WHERE id=$1 AND conversation_id=$2', [result.traceId, conversationId])).rows[0].context;
    const detail = trace.productPreparation.find(step => step.name.includes('get_product_detail'));
    assert.equal(detail.ok, true); assert.equal(Boolean(detail.reused), round === 2);
    assert.deepEqual(trace.requestContext.productIds, [product.id]);
    assert.deepEqual(trace.requestContext.productReferences, body.context.productReferences);
    for (const call of trace.modelCalls.filter(call => call.purpose === 'planner')) {
      const context = JSON.parse(call.request.messages.at(-1).content);
      assert.equal(context.agentTranscript, undefined);
      assert.equal(context.question, body.question);
      assert.equal(context.productContext.products.filter(p => p.id === product.id).length, 1);
    }
    console.log(JSON.stringify({ round, reusedDetail: Boolean(detail.reused), plannerCalls: trace.modelCalls.filter(call => call.purpose === 'planner').length, canonicalProducts: trace.products.length, answered: !result.refused }));
  }
  const messages = await request(`/api/chat/conversations/${conversationId}/messages`, undefined, 'GET').then(r => r.json());
  assert.equal(messages.filter(m => m.role === 'user').length, 2);
  assert.ok(messages.filter(m => m.role === 'user').every(m => m.content === body.question && m.context.productIds.length === 1 && m.context.products[0].name === product.name));
  for (const message of messages.filter(m => m.role === 'user')) assert.deepEqual(message.context.productReferences, body.context.productReferences);
  console.log('Live HTTP readable question, product ranges, reuse, persistence and model-input deduplication passed. No browser used.');
} finally {
  if (conversationId && cookie) {
    const response = await request(`/api/chat/conversations/${conversationId}`, undefined, 'DELETE');
    console.log(response.status === 204 ? 'Removed only the isolated smoke conversation.' : `Fixture cleanup HTTP ${response.status}`);
  }
  await pool.end();
}
