import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { ValidationPipe } from '@nestjs/common';
import { z } from 'zod';
import { AskQuestionDto } from '../dist/chat/chat.dto.js';
import { AgentMessageDto } from '../dist/integrations/integration.dto.js';
import { normalizeRequestContext, contextFingerprint, messageContext } from '../dist/chat/request-context.js';
import { ProductContextPreparer } from '../dist/chat/product-context-preparer.js';
import { projectProductTranscript } from '../dist/chat/product-context.js';
import { ToolExecutionService } from '../dist/ai/tools/tool-execution.js';
import { ToolPolicy } from '../dist/ai/tools/tool-policy.js';
import { ContextBuilder } from '../dist/chat/context-builder.js';
import { AgentRunner } from '../dist/ai/agent/agent-runner.js';
import { AgentLoop } from '../dist/ai/agent/agent-loop.js';
import { ChatOrchestratorService } from '../dist/chat/chat-orchestrator.service.js';
import { DEFAULT_AGENT_CONFIGURATION } from '../dist/config/agent-config.js';
import { ConversationService } from '../dist/chat/conversation.service.js';

const product = (id, revision = 'v1') => ({ id, name: `产品 ${id}`, brand: 'fixture', categoryId: 'heating', category: '取暖', summary: '产品摘要', description: `DETAIL_BODY_${id}_${revision}`, specifications: { 功率: '2000W' }, suggestedPrice: '199元', imageUrl: null, sourceUrl: null, revision });
const hit = { chunkId: 123, documentId: 9, documentTitle: '使用说明', originalFilename: 'guide.md', content: '仅供室内使用。', headingPath: '', sourceStartLine: 1, sourceEndLine: 1, score: 0.9 };
function fixture() {
  const data = new Map(['1','2','3','4','5'].map(id => [id, product(id)]));
  const counts = { detail: 0, search: 0 };
  let failSearch = false;
  const tools = [
    { name: 'get_product_detail', inputSchema: z.object({ productId: z.string().trim().min(1).max(80) }), execute: async ({ productId }) => {
      counts.detail++; const p = data.get(productId);
      return p ? { success: true, data: p, content: JSON.stringify(p) } : { success: false, content: 'not found', errorCode: 'product_not_found' };
    } },
    { name: 'search_knowledge', inputSchema: z.object({ query: z.string().max(200), topK: z.number().optional() }), execute: async () => {
      counts.search++;
      return failSearch ? { success: false, content: 'failed', errorCode: 'tool_timeout' } : { success: true, data: { hits: [hit] }, content: '使用说明' };
    } },
  ];
  const execution = new ToolExecutionService({ list: () => tools, get: name => { const t = tools.find(t => t.name === name); if (!t) throw Error('missing'); return t; } }, new ToolPolicy());
  const catalog = {
    revisions: async ids => new Map(ids.filter(id => data.has(id)).map(id => [id, data.get(id).revision])),
    getProductDetails: async ids => { counts.detail += ids.length; return ids.flatMap(id => data.has(id) ? [data.get(id)] : []); },
  };
  return { data, counts, execution, preparer: new ProductContextPreparer(catalog, execution), failSearch: () => { failSearch = true; } };
}
const configuration = () => structuredClone(DEFAULT_AGENT_CONFIGURATION);
const final = { content: JSON.stringify({ type: 'final', status: 'answered', answer: '这些产品可用于室内。', productIds: ['1'], citationIds: [123] }), model: 'fixture', inputTokens: 10, outputTokens: 5, totalTokens: 15 };

test('both browser and external DTOs deduplicate before applying the five-product limit', async () => {
  const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });
  for (const [metatype, text] of [[AskQuestionDto, { question: '产品如何使用？' }], [AgentMessageDto, { message: '产品如何使用？' }]]) {
    const body = await pipe.transform({ ...text, context: { productIds: ['1',' 1 ','2','3','4','5','5'] } }, { type: 'body', metatype });
    assert.deepEqual(body.context.productIds, ['1','2','3','4','5']);
    for (const context of [{ productIds: ['1','2','3','4','5','6'] }, { productIds: '1' }, { productIds: [1] }, { productIds: [''] }, { productIds: ['x'.repeat(81)] }, { productIds: ['1'], price: '1元' }]) {
      await assert.rejects(() => pipe.transform({ ...text, context }, { type: 'body', metatype }), e => e.getStatus() === 400);
    }
    await assert.rejects(() => pipe.transform({ ...text, context: [] }, { type: 'body', metatype }), e => e.getStatus() === 400);
  }
});
test('context identity ignores duplicates/order but never equates different products', () => {
  assert.equal(contextFingerprint(normalizeRequestContext({ productIds: ['2','1','1'] })), contextFingerprint({ productIds: ['1','2'] }));
  assert.notEqual(contextFingerprint({ productIds: ['1'] }), contextFingerprint({ productIds: ['2'] }));
  assert.deepEqual(normalizeRequestContext(), {});
  assert.deepEqual(messageContext({ productIds: ['1'] }, [product('1'), product('2')]), { productIds: ['1'], products: [{ id: '1', name: '产品 1' }] });
  assert.throws(() => normalizeRequestContext({ productIds: ['1'], systemPrompt: 'overwrite' }), e => e.getStatus() === 400);
});
test('inline reference positions are optional, validated and part of idempotency identity', async () => {
  const question = '前🙂\n后';
  const context = { productIds: ['1','2'], productReferences: [{ productId: '2', offset: 4 }, { productId: '1', offset: 1 }] };
  const normalized = normalizeRequestContext(context, question);
  assert.deepEqual(normalized.productReferences, [...context.productReferences].reverse());
  const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });
  for (const [metatype, text] of [[AskQuestionDto, { question }], [AgentMessageDto, { message: question }]]) {
    const body = await pipe.transform({ ...text, context }, { type: 'body', metatype });
    assert.deepEqual(JSON.parse(JSON.stringify(body.context.productReferences)), context.productReferences);
    for (const reference of [{ productId: '1', offset: -1 }, { productId: '1', offset: 0.5 }, { productId: '1', offset: 2001 }, { productId: '1', offset: 0, name: 'client-fact' }]) {
      await assert.rejects(() => pipe.transform({ ...text, context: { productIds: ['1'], productReferences: [reference] } }, { type: 'body', metatype }), e => e.getStatus() === 400);
    }
  }
  for (const references of [[{ productId: 'missing', offset: 0 }], [{ productId: '1', offset: question.length + 1 }], [{ productId: '1', offset: 0 }, { productId: '1', offset: 1 }]]) {
    assert.throws(() => normalizeRequestContext({ productIds: ['1'], productReferences: references }, question), e => e.getStatus() === 400);
  }
  assert.equal(contextFingerprint(normalizeRequestContext({ productIds: ['1'], productReferences: [] })), '["1"]');
  assert.notEqual(contextFingerprint(normalized), contextFingerprint({ ...normalized, productReferences: [{ productId: '1', offset: 2 }, { productId: '2', offset: 4 }] }));
});
test('readable product names use validated non-overlapping UTF-16 ranges without trusting client facts', async () => {
  const question = '这个产品怎么样\n米家电暖器';
  const context = { productIds: ['1'], productReferences: [{ productId: '1', offset: 8, length: 5 }] };
  assert.deepEqual(normalizeRequestContext(context, question), context);
  const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });
  for (const [metatype, text] of [[AskQuestionDto, { question }], [AgentMessageDto, { message: question }]]) {
    const body = await pipe.transform({ ...text, context }, { type: 'body', metatype });
    assert.deepEqual(JSON.parse(JSON.stringify(body.context)), context);
    for (const length of [0, -1, 0.5, 201, '5']) {
      await assert.rejects(() => pipe.transform({ ...text, context: { productIds: ['1'], productReferences: [{ productId: '1', offset: 8, length }] } }, { type: 'body', metatype }), e => e.getStatus() === 400);
    }
  }
  for (const productReferences of [[{ productId: '1', offset: 10, length: 5 }], [{ productId: '1', offset: 8, length: 5 }, { productId: '2', offset: 9, length: 2 }]]) {
    assert.throws(() => normalizeRequestContext({ productIds: ['1', '2'], productReferences }, question), e => e.getStatus() === 400);
  }
  assert.notEqual(contextFingerprint(context), contextFingerprint({ productIds: ['1'], productReferences: [{ productId: '1', offset: 8 }] }));
  assert.deepEqual(messageContext(context, [product('1')]), { ...context, products: [{ id: '1', name: '产品 1' }] });
});
test('five product details and current-question search finish before the first model call', async () => {
  const f = fixture(); const cfg = configuration();
  const prepared = await f.preparer.prepare('它们有什么区别？', ['1','2','3','4','5'], [], cfg);
  assert.equal(prepared.products.length, 5);
  assert.equal(prepared.executionState.callCount, 2);
  assert.equal(f.counts.detail, 5); assert.equal(f.counts.search, 1);
  assert.equal(prepared.evidence[0].chunkId, 123);
});
test('second turn reuses valid details; changed versions, summaries and disabled products do not', async () => {
  const f = fixture(); const cfg = configuration();
  const first = await f.preparer.prepare('适合卧室吗？', ['1','2'], [], cfg);
  const second = await f.preparer.prepare('怎么清洁？', ['1'], first.products, cfg);
  assert.equal(f.counts.detail, 2); assert.equal(f.counts.search, 2);
  assert.equal(second.entries[0].outcome.trace.reused, true);
  f.data.set('1', product('1','v2'));
  const changed = await f.preparer.prepare('价格多少？', ['1'], first.products, cfg);
  assert.equal(f.counts.detail, 3); assert.equal(changed.products[0].revision, 'v2');
  const summaryOnly = { id: '2', name: '摘要', revision: 'v1' };
  await f.preparer.prepare('功率多少？', ['2'], [summaryOnly], cfg);
  assert.equal(f.counts.detail, 4);
  f.data.delete('1');
  const deleted = await f.preparer.prepare('价格多少？', ['1'], changed.products, cfg);
  assert.equal(deleted.products.length, 0); assert.equal(deleted.entries[0].outcome.result.errorCode, 'product_not_found');
});
test('preload obeys permissions and the same per-run budget; failures stay recoverable', async () => {
  const f = fixture(); const cfg = configuration();
  cfg.runtime.allowedTools = ['search_knowledge'];
  const denied = await f.preparer.prepare('产品如何使用？', ['1'], [product('1')], cfg);
  assert.equal(f.counts.detail, 0); assert.equal(denied.products.length, 0);
  assert.equal(denied.entries[0].outcome.result.errorCode, 'tool_not_allowed');
  cfg.runtime.allowedTools = ['get_product_detail', 'search_knowledge']; cfg.runtime.maxToolCalls = 1;
  const limited = await f.preparer.prepare('产品如何使用？', ['1','2'], [], cfg);
  assert.equal(limited.products.length, 2); assert.equal(limited.executionState.callCount, 1);
  assert.equal(limited.entries[1].outcome.result.errorCode, 'tool_call_limit_exceeded');
  f.failSearch(); cfg.runtime.maxToolCalls = 6;
  const failed = await f.preparer.prepare('产品如何使用？', ['missing','1'], [], cfg);
  assert.equal(failed.products.length, 1); assert.equal(failed.evidence.length, 0);
  assert.equal(failed.entries.at(-1).outcome.result.errorCode, 'tool_timeout');
});
test('same product appears only once in actual model messages, including a repeated native tool request and next turn', async () => {
  const f = fixture(); const builder = new ContextBuilder();
  const requests = []; let first = true;
  const llm = { model: 'fixture', completeDetailed: async (_s, _u, _m, _p, options) => {
    assert.ok(f.counts.search > 0); requests.push(structuredClone(options.messages));
    if (first) { first = false; return { ...final, content: '', toolCalls: [{ id: 'detail-call', name: 'get_product_detail', arguments: { productId: '1' } }] }; }
    return final;
  } };
  const runner = new AgentRunner(new AgentLoop(llm, builder, f.execution), builder);
  const orchestrator = new ChatOrchestratorService(runner, llm, undefined, undefined, undefined, undefined, f.preparer);
  const question = '米家电暖器适合卧室吗？';
  const reference = { productId: '1', offset: 0, length: 5 };
  const run1 = await orchestrator.askDetailed(question, [], '', undefined, undefined, undefined, undefined, undefined, { conversationId: 'same-conversation', traceId: 'turn-1', requestContext: { productIds: ['1'], productReferences: [reference] } });
  const original = structuredClone(run1.contextSnapshot.agentTranscript);
  assert.equal(original.find(m => m.role === 'user').content, question);
  assert.deepEqual(original.find(m => m.role === 'user').productReferences, [reference]);
  assert.deepEqual(JSON.parse(requests[0].at(-1).content).productContext.productReferences, [reference]);
  assert.ok(requests[0].some(m => m.role === 'user' && JSON.parse(m.content).context?.productReferences?.[0]?.length === 5));
  assert.equal(JSON.parse(requests[0].at(-1).content).question, question);
  const run2 = await orchestrator.askDetailed('怎么清洁？', [], '', undefined, undefined, undefined, undefined, undefined, { conversationId: 'same-conversation', traceId: 'turn-2', requestContext: { productIds: ['1'] }, priorTranscript: original, priorProducts: run1.contextSnapshot.products });
  assert.equal(f.counts.detail, 1); assert.equal(f.counts.search, 2);
  assert.equal(run2.result.refused, false); assert.equal(run2.result.citations[0].chunkId, 123);
  for (const messages of requests) {
    assert.equal(JSON.stringify(messages).split('DETAIL_BODY_1_v1').length - 1, 1);
    const payload = JSON.parse(messages.at(-1).content);
    assert.equal(payload.agentTranscript, undefined);
    assert.equal(payload.productContext.products.length, 1);
  }
  assert.match(original.find(m => m.role === 'tool').content, /DETAIL_BODY_1_v1/);
  assert.equal(run1.contextSnapshot.toolCalls[0].reused, true);
  assert.equal(run2.contextSnapshot.productPreparation[0].reused, true);
  assert.deepEqual(original, run1.contextSnapshot.agentTranscript); // No rewriting audit history.
});
test('missing product never re-injects stale historical detail, and native pairs stay intact', () => {
  const transcript = [{ role: 'assistant', toolCalls: [{ id: 'call', name: 'get_product_detail', arguments: { productId: '1' } }] }, { role: 'tool', toolCallId: 'call', content: JSON.stringify(product('1')) }];
  const projected = projectProductTranscript(transcript, new Set(['1']));
  assert.equal(projected.length, 2); assert.equal(projected[1].toolCallId, 'call');
  assert.doesNotMatch(projected[1].content, /DETAIL_BODY/);
  assert.match(transcript[1].content, /DETAIL_BODY/);
});
test('conversation persistence keeps the complete readable question and independent product association', async () => {
  let stored;
  const db = { transaction: async fn => fn({ query: async (sql, args) => {
    if (sql.startsWith('INSERT INTO conversation_messages') && sql.includes("'user'")) { stored = args; return { rows: [{ id: 1 }] }; }
    if (sql.startsWith('INSERT INTO conversation_messages')) return { rows: [{ id: 2 }] };
    return { rows: [] };
  } }) };
  const service = new ConversationService(db, {}, { model: 'fixture' });
  await service.saveResult('conversation', '如何使用？\n米家电暖器', { traceId: 'trace', result: { answer: '见说明书', refused: false, citations: [] }, contextSnapshot: { requestContext: { productIds: ['1'], productReferences: [{ productId: '1', offset: 6, length: 5 }] }, products: [product('1')] }, rawModelOutput: 'ok', inputTokens: 1, outputTokens: 1, totalTokens: 2 }, 5, null);
  assert.equal(stored[1], '如何使用？\n米家电暖器');
  assert.deepEqual(JSON.parse(stored[2]), { productIds: ['1'], productReferences: [{ productId: '1', offset: 6, length: 5 }], products: [{ id: '1', name: '产品 1' }] });
});
test('conversation-level idempotency rejects a changed product before any model call', async () => {
  const db = { query: async sql => sql.includes('FROM conversation_runs WHERE conversation_id') ? { rows: [{ id: 'run', question: '如何使用？', context: { productIds: ['1'] }, status: 'completed' }] } : { rows: [] } };
  const service = new ConversationService(db, {}, {});
  await assert.rejects(() => service.ask('owner', 'conversation', '如何使用？', undefined, undefined, 'same-key', undefined, undefined, { productIds: ['2'] }), e => e.getStatus() === 409);
});
test('repositioning a reference cannot reuse a different pending request body', async () => {
  const db = { query: async sql => sql.includes('FROM conversation_runs WHERE conversation_id') ? { rows: [{ id: 'run', question: '如何使用？', context: { productIds: ['1'], productReferences: [{ productId: '1', offset: 0 }] }, status: 'completed' }] } : { rows: [] } };
  const service = new ConversationService(db, {}, {});
  await assert.rejects(() => service.ask('owner', 'conversation', '如何使用？', undefined, undefined, 'same-key', undefined, undefined, { productIds: ['1'], productReferences: [{ productId: '1', offset: 2 }] }), e => e.getStatus() === 409);
});
test('all-missing batch is a recorded preparation failure, not a forced refusal', async () => {
  const f = fixture(); const result = await f.preparer.prepare('哪个适合卧室？', ['missing-a','missing-b'], [], configuration());
  assert.equal(result.entries[0].outcome.result.errorCode, 'product_not_found');
  assert.deepEqual(result.entries[0].outcome.result.data.missingProductIds, ['missing-a','missing-b']);
  assert.equal(result.products.length, 0); assert.equal(result.evidence.length, 1);
});
test('truncated tool content still becomes a reference, without duplicating the canonical detail', () => {
  const p = product('1'); const context = new ContextBuilder().build({ question: '如何使用？', summary: '', recentHistory: [], nativeTranscript: true, products: [p], toolResults: [{ tool: 'get_product_detail', productRef: p.id, result: JSON.stringify(p).slice(0, 100) + '[tool_result_truncated]' }] });
  assert.equal(context.userPrompt.split(p.description).length - 1, 1);
  assert.deepEqual(JSON.parse(context.userPrompt).toolResults, [{ tool: 'get_product_detail', productRef: '1' }]);
});
test('model-facing transcript keeps failed tool results instead of masking their error', () => {
  const transcript = [{ role: 'assistant', toolCalls: [{ id: 'call', name: 'get_product_detail', arguments: { productId: '1' } }] }, { role: 'tool', toolCallId: 'call', content: JSON.stringify({ error: 'product_not_found' }) }];
  assert.deepEqual(projectProductTranscript(transcript, new Set(['1'])), transcript);
});
