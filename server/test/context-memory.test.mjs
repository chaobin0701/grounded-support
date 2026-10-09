import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';
import { AgentRunner } from '../dist/ai/agent/agent-runner.js';
import { AgentLoop } from '../dist/ai/agent/agent-loop.js';
import { ContextBuilder } from '../dist/chat/context-builder.js';
import { ContextMemoryService } from '../dist/chat/context-memory.service.js';
import { ChatOrchestratorService } from '../dist/chat/chat-orchestrator.service.js';
import { ProductContextPreparer } from '../dist/chat/product-context-preparer.js';
import { ProductDetailTool } from '../dist/ai/tools/product-catalog/product-detail.tool.js';
import { KnowledgeSearchTool } from '../dist/ai/tools/knowledge-search.tool.js';
import { ToolRegistry } from '../dist/ai/tools/tool-registry.js';
import { ToolExecutionService } from '../dist/ai/tools/tool-execution.js';
import { ToolPolicy } from '../dist/ai/tools/tool-policy.js';
import { DEFAULT_AGENT_CONFIGURATION, parseAgentConfiguration, agentConfigurationRevision, storedAgentConfigurationRevision } from '../dist/config/agent-config.js';
import { makeContextBlock, productResources, knowledgeResources, legacyContextBlocks, readContextBlocks, evidenceDigest } from '../dist/ai/context/context-contribution.js';
import { SearchService } from '../dist/documents/search.service.js';
import { ConversationService } from '../dist/chat/conversation.service.js';

const product = (id, revision = 'v1') => ({ id, name: `产品${id}`, brand: 'fixture', categoryId: 'fixture', category: '分类', summary: '概述', description: `DETAIL_${id}_${revision}`, specifications: { 功率: '100 W' }, suggestedPrice: '199元', revision });
const hit = (chunkId = 1) => ({ chunkId, documentId: 10, documentTitle: '使用说明', originalFilename: 'guide.md', ordinal: 0, headingPath: '安全', content: `EVIDENCE_${chunkId}`, sourceStartLine: 1, sourceEndLine: 3, score: 0.9, indexKind: 'live' });
const final = () => ({ content: JSON.stringify({ type: 'final', status: 'answered', answer: '产品资料已提供。', productIds: ['1'], citationIds: [1] }), model: 'fixture', inputTokens: 1, outputTokens: 1, totalTokens: 2 });
const toolReply = calls => ({ content: JSON.stringify({ commentary: '我先查询相关资料。' }), toolCalls: calls });
function fixture() {
  const cfg = structuredClone(DEFAULT_AGENT_CONFIGURATION);
  const data = new Map(['1', '2', '3'].map(id => [id, product(id)]));
  const evidence = new Map([[1, hit(1)], [2, hit(2)]]);
  const counts = { detail: 0, search: 0, revisions: 0, evidenceValidation: 0 };
  const catalog = {
    revisions: async ids => { counts.revisions++; return new Map(ids.filter(id => data.has(id)).map(id => [id, data.get(id).revision])); },
    getProductDetail: async id => { counts.detail++; return data.get(id) ?? null; },
    getProductDetails: async ids => { counts.detail++; return ids.flatMap(id => data.has(id) ? [data.get(id)] : []); },
  };
  const search = {
    searchForAgent: async () => { counts.search++; return { hits: [...evidence.values()], retrievalMode: 'lexical-only', vectorIndexedChunks: 0 }; },
    restoreEvidence: async hits => { counts.evidenceValidation++; return hits.filter(old => evidence.has(old.chunkId) && evidenceDigest(old) === evidenceDigest(evidence.get(old.chunkId))); },
  };
  const registry = new ToolRegistry(); registry.register(new ProductDetailTool(catalog)); registry.register(new KnowledgeSearchTool(search));
  const execution = new ToolExecutionService(registry, new ToolPolicy({ agent: cfg }));
  const memory = new ContextMemoryService(catalog, search);
  const requests = [], replies = [];
  const llm = { model: 'fixture', maxOutputTokens: 1200, completeDetailed: async (_system, _prompt, _model, _purpose, options) => {
    requests.push(structuredClone(options.messages));
    const reply = replies.shift(); return typeof reply === 'function' ? reply(JSON.parse(options.messages.at(-1).content), options.messages) : reply ?? final();
  } };
  const builder = new ContextBuilder({ agent: cfg });
  const runner = new AgentRunner(new AgentLoop(llm, builder, execution), builder, { agent: cfg });
  const orchestrator = new ChatOrchestratorService(runner, llm, undefined, undefined, { agent: cfg }, undefined, new ProductContextPreparer(catalog, execution), memory);
  const ask = (question, context = {}) => orchestrator.askDetailed(question, [], '', undefined, undefined, undefined, undefined, undefined,
    { conversationId: 'conversation-a', traceId: `turn-${requests.length + 1}`, ...context });
  return { cfg, data, evidence, counts, registry, execution, memory, runner, ask, replies, requests };
}

test('passive product and RAG results persist and restore on a second turn with no product IDs, exactly once', async () => {
  const f = fixture(); const first = await f.ask('这三款有什么特点？', { requestContext: { productIds: ['1', '2', '3'] } });
  assert.equal(first.contextSnapshot.runtimeContextBlocks.length, 2);
  assert.ok(first.contextSnapshot.runtimeContextBlocks.every(b => b.origin === 'preload'));
  assert.equal(first.contextSnapshot.agentTranscript.some(m => m.role === 'tool'), false, 'preload does not fabricate native tool calls');
  f.replies.push((context, messages) => {
    assert.deepEqual(context.productContext.productIds, []);
    assert.deepEqual(context.productContext.products.map(p => p.id), ['1', '2', '3']);
    assert.deepEqual(context.initialEvidence.map(e => e.chunkId), [1, 2]);
    assert.equal(JSON.stringify(messages).split('DETAIL_1_v1').length - 1, 1);
    assert.equal(JSON.stringify(messages).split('EVIDENCE_1').length - 1, 1);
    return final();
  });
  const second = await f.ask('价格呢？', { contextBlocks: first.contextSnapshot.runtimeContextBlocks, priorTranscript: first.contextSnapshot.agentTranscript });
  assert.equal(f.counts.detail, 1); assert.equal(f.counts.search, 1);
  assert.equal(second.contextSnapshot.contextMemory.restored, 5);
  assert.equal(second.contextSnapshot.runtimeContextBlocks.length, 0, 'restored bodies are not journaled as new calls every turn');
  assert.equal(second.result.refused, false); assert.equal(second.result.citations.length, 1);
});

test('model tools and passive preload share one recorder; repeated native product requests reuse revision-checked memory', async () => {
  const f = fixture();
  const calls = [{ id: 'product', name: 'get_product_detail', arguments: { productId: '1' } }, { id: 'rag', name: 'search_knowledge', arguments: { query: '资料' } }];
  f.replies.push(toolReply(calls), final());
  const first = await f.ask('产品1如何使用？');
  assert.deepEqual(first.contextSnapshot.runtimeContextBlocks.map(b => b.origin), ['model', 'model']);
  assert.deepEqual(first.contextSnapshot.runtimeContextBlocks.map(b => b.toolCallId), ['product', 'rag']);
  f.replies.push(toolReply([{ id: 'repeat', name: 'get_product_detail', arguments: { productId: '1' } }]), (context, messages) => {
    assert.equal(JSON.stringify(messages).split('DETAIL_1_v1').length - 1, 1);
    assert.equal(JSON.stringify(messages).split('EVIDENCE_1').length - 1, 1);
    assert.equal(context.initialEvidence.length, 2);
    assert.deepEqual(messages.filter(m => m.role === 'tool').map(m => m.toolCallId), ['product', 'rag', 'repeat']);
    return final();
  });
  const second = await f.ask('再看一下', { contextBlocks: first.contextSnapshot.runtimeContextBlocks, priorTranscript: first.contextSnapshot.agentTranscript });
  assert.equal(f.counts.detail, 1); assert.equal(f.counts.search, 1);
  assert.equal(second.contextSnapshot.toolCalls[0].reused, true);
});

test('memory switches block historical bodies without removing native call/result pairs or blocking current queries', async () => {
  const f = fixture();
  f.replies.push(toolReply([{ id: 'p', name: 'get_product_detail', arguments: { productId: '1' } }, { id: 'r', name: 'search_knowledge', arguments: { query: '资料' } }]), final());
  const first = await f.ask('查询资料');
  const original = structuredClone(first.contextSnapshot);
  for (const flags of [{ enabled: false, products: true, knowledge: true }, { enabled: true, products: false, knowledge: true }, { enabled: true, products: true, knowledge: false }]) {
    f.cfg.memory.toolResults = flags;
    f.replies.push((context, messages) => {
      if (!flags.enabled || !flags.products) { assert.equal(context.productContext.products.length, 0); assert.doesNotMatch(JSON.stringify(messages), /DETAIL_1_v1/); }
      if (!flags.enabled || !flags.knowledge) { assert.equal(context.initialEvidence.length, 0); assert.doesNotMatch(JSON.stringify(messages), /EVIDENCE_1/); }
      assert.deepEqual(messages.filter(m => m.role === 'tool').map(m => m.toolCallId), ['p', 'r']);
      return final();
    });
    await f.ask('继续', { contextBlocks: first.contextSnapshot.runtimeContextBlocks, priorTranscript: first.contextSnapshot.agentTranscript });
  }
  assert.deepEqual(first.contextSnapshot, original);
  f.replies.push(toolReply([{ id: 'fresh', name: 'get_product_detail', arguments: { productId: '1' } }]), final());
  const fresh = await f.ask('重新查询');
  assert.equal(fresh.contextSnapshot.products.length, 1); assert.equal(fresh.contextSnapshot.runtimeContextBlocks.length, 1);
});

test('changed, deleted, unpermitted and failed validation resources cannot be injected as valid memory', async () => {
  const f = fixture(); const first = await f.ask('查询', { requestContext: { productIds: ['1', '2'] } });
  f.data.set('1', product('1', 'v2')); f.data.delete('2'); f.evidence.delete(1); f.evidence.set(2, { ...hit(2), content: '更新资料' });
  const restored = await f.memory.restore('conversation-a', first.contextSnapshot.runtimeContextBlocks, f.cfg);
  assert.equal(restored.resources.length, 0);
  assert.deepEqual(restored.historyProductIds, ['1', '2']);
  f.replies.push((context, messages) => { assert.equal(context.productContext.products.length, 0); assert.equal(context.initialEvidence.length, 0); assert.doesNotMatch(JSON.stringify(messages), /DETAIL_[12]_v1|EVIDENCE_[12]/); return final(); });
  await f.ask('继续问', { contextBlocks: first.contextSnapshot.runtimeContextBlocks, priorTranscript: first.contextSnapshot.agentTranscript });
  const deny = fixture(); const base = await deny.ask('查询', { requestContext: { productIds: ['1'] } });
  deny.cfg.runtime.allowedTools = ['load_skill'];
  assert.equal((await deny.memory.restore('conversation-a', base.contextSnapshot.runtimeContextBlocks, deny.cfg)).resources.length, 0);
  const broken = new ContextMemoryService({ revisions: async () => { throw Error('PRIVATE'); } }, { restoreEvidence: async () => { throw Error('PRIVATE'); } });
  assert.equal((await broken.restore('conversation-a', base.contextSnapshot.runtimeContextBlocks, DEFAULT_AGENT_CONFIGURATION)).resources.length, 0);
});

test('oversized unrecorded product bodies cannot bypass disabled memory through old native messages', async () => {
  const f = fixture(); f.cfg.runtime.maxToolResultChars = 1000;
  f.data.set('1', { ...product('1'), description: 'OVERSIZED_OLD_DETAIL'.repeat(600) });
  f.replies.push(toolReply([{ id: 'large', name: 'get_product_detail', arguments: { productId: '1' } }]), final());
  const first = await f.ask('查询');
  assert.equal(first.contextSnapshot.runtimeContextBlocks.length, 0);
  f.cfg.memory.toolResults.enabled = false;
  f.replies.push((context, messages) => { assert.equal(context.productContext.products.length, 0); assert.doesNotMatch(JSON.stringify(messages), /OVERSIZED_OLD_DETAIL/); return final(); });
  await f.ask('继续', { contextBlocks: [], priorTranscript: first.contextSnapshot.agentTranscript });
});

test('newest versions win; restored resources are bounded and cannot leak across conversations', async () => {
  const f = fixture(); const first = await f.ask('查询', { requestContext: { productIds: ['1'] } });
  assert.equal((await f.memory.restore('conversation-b', first.contextSnapshot.runtimeContextBlocks, f.cfg)).resources.length, 0);
  const next = makeContextBlock(productResources({ success: true, content: '', data: product('1', 'v2') }), { source: 'get_product_detail', origin: 'model', conversationId: 'conversation-a' });
  assert.equal((await f.memory.restore('conversation-a', [next, ...first.contextSnapshot.runtimeContextBlocks], f.cfg)).products.length, 0, 'no fallback to an older body when the latest known body is invalid');
  const constrained = new ContextMemoryService({ revisions: async () => new Map([['1', 'v1']]) }, { restoreEvidence: async hits => hits }, { inspect: () => ({ inputBudgetTokens: 1 }) });
  assert.equal((await constrained.restore('conversation-a', first.contextSnapshot.runtimeContextBlocks, f.cfg)).resources.length, 0);
});

test('trusted host extensions inject and persist the same bounded context blocks without enabling arbitrary visitor data', async () => {
  const f = fixture(); f.cfg.runtime.allowedTools.push('host_product_lookup');
  const block = makeContextBlock(productResources({ success: true, content: '', data: { ...product('1'), apiKey: 'PRIVATE_SECRET' } }), { source: 'host_product_lookup', origin: 'host', conversationId: 'conversation-a' });
  f.replies.push(context => { assert.equal(context.productContext.products[0].id, '1'); return final(); });
  const first = await f.ask('由业务流程带入', { currentContextBlocks: [block] });
  assert.equal(first.contextSnapshot.runtimeContextBlocks[0].origin, 'host');
  assert.doesNotMatch(JSON.stringify(first.contextSnapshot.runtimeContextBlocks), /PRIVATE_SECRET|apiKey/);
  assert.equal((await f.memory.restore('conversation-a', first.contextSnapshot.runtimeContextBlocks, f.cfg)).products.length, 1);
  f.cfg.runtime.allowedTools = f.cfg.runtime.allowedTools.filter(name => name !== 'host_product_lookup');
  assert.equal((await f.memory.restore('conversation-a', first.contextSnapshot.runtimeContextBlocks, f.cfg)).resources.length, 0);
});

test('only opt-in successful projections contribute memory; failed tools and arbitrary raw secrets never do', async () => {
  const registry = new ToolRegistry();
  registry.register({ name: 'unknown_payload', description: '', inputSchema: z.object({}), execute: async () => ({ success: true, content: 'PRIVATE', data: { apiKey: 'PRIVATE' } }) });
  registry.register({ name: 'failed', description: '', inputSchema: z.object({}), contributeContext: productResources, execute: async () => ({ success: false, content: 'failed', data: product('1') }) });
  const execution = new ToolExecutionService(registry, new ToolPolicy());
  assert.equal((await execution.execute('unknown_payload', {}, {}, execution.createState())).contextResources, undefined);
  assert.equal((await execution.execute('failed', {}, {}, execution.createState())).contextResources, undefined);
  const bad = knowledgeResources({ success: true, content: '', data: { hits: [{ ...hit(), apiKey: 'PRIVATE' }] } });
  assert.doesNotMatch(JSON.stringify(bad), /PRIVATE|apiKey/);
  assert.deepEqual(readContextBlocks([{ version: 1, conversationId: 'conversation-a', source: 'search_knowledge', origin: 'preload', resources: [{ ...bad[0], digest: 'forged' }] }], 'conversation-a'), []);
});

test('older product preload traces are imported read-only into the same recovery mechanism', async () => {
  const f = fixture();
  const snapshot = { products: [product('1')], productPreparation: [{ name: 'search_knowledge', ok: true, result: { hits: [hit()] } }] };
  const original = structuredClone(snapshot);
  const blocks = legacyContextBlocks(snapshot, 'conversation-a', 'old-trace');
  const restored = await f.memory.restore('conversation-a', blocks, f.cfg);
  assert.equal(restored.products.length, 1); assert.equal(restored.evidence.length, 1);
  assert.deepEqual(snapshot, original);
});

test('malformed legacy entries are skipped and legacy/current records for one chunk deduplicate', async () => {
  assert.deepEqual(legacyContextBlocks({ productPreparation: [null, 1], agentTranscript: [null, false] }, 'conversation-a'), []);
  const f = fixture();
  const oldHit = { ...hit(1) }; delete oldHit.indexKind;
  const block = evidence => makeContextBlock(knowledgeResources({ success: true, content: '', data: { hits: [evidence] } }),
    { source: 'search_knowledge', origin: 'preload', conversationId: 'conversation-a' });
  const restored = await f.memory.restore('conversation-a', [block(hit(1)), block(oldHit)], f.cfg);
  assert.equal(restored.evidence.length, 1);
  assert.equal(restored.diagnostics.candidates, 1);
  assert.equal(restored.evidence[0].indexKind, 'live');
});

test('evidence validation uses current live/published visibility and rejects changed content or index versions', async () => {
  const queries = [], current = { ...hit(), indexKind: 'published', indexVersionId: 8 };
  const search = new SearchService({ query: async (sql, args) => { queries.push({ sql, args }); return { rows: sql.includes('FROM index_chunks') ? [current] : [] }; } }, {});
  assert.equal((await search.restoreEvidence([{ ...current, score: 0.5 }])).length, 1);
  assert.equal((await search.restoreEvidence([{ ...current, indexVersionId: 7 }])).length, 0);
  assert.equal((await search.restoreEvidence([{ ...current, content: '旧内容' }])).length, 0);
  assert.ok(queries.every(q => q.sql.includes('kb.enabled_for_chat') && q.sql.includes('d.enabled_for_retrieval') && q.sql.includes('d.archived_at IS NULL')));
  assert.ok(queries.filter(q => q.sql.includes('FROM index_chunks')).every(q => q.sql.includes('c.version_id=kb.active_index_version_id')));
});

test('legacy settings accept defaults without changing persisted concurrency revisions', () => {
  const old = structuredClone(DEFAULT_AGENT_CONFIGURATION); delete old.memory.toolResults;
  const parsed = parseAgentConfiguration(old);
  assert.deepEqual(parsed.memory.toolResults, { enabled: true, products: true, knowledge: true });
  assert.notEqual(storedAgentConfigurationRevision(old), agentConfigurationRevision(parsed));
  assert.equal(storedAgentConfigurationRevision(parsed), agentConfigurationRevision(parsed));
  assert.throws(() => parseAgentConfiguration({ ...parsed, memory: { ...parsed.memory, toolResults: { enabled: 'false', products: true, knowledge: true } } }));
});

test('conversation snapshot loads only owner-scoped traces and preserves context blocks for later turns', async () => {
  const block = makeContextBlock(productResources({ success: true, content: '', data: product('1') }), { source: 'get_product_detail', origin: 'preload', conversationId: 'conversation-a' });
  const queries = [];
  const service = new ConversationService({ query: async (sql, args) => {
    queries.push({ sql, args });
    if (sql.includes('visitor_session_id = $2')) return { rows: args[1] === 'owner-a' ? [{ id: 'conversation-a', summary: '' }] : [] };
    if (sql.includes("context_snapshot->'agentTranscript'")) return { rows: [{ id: 'trace', agentTranscript: [], contextSnapshot: { runtimeContextBlocks: [block] } }] };
    return { rows: [] };
  } }, {}, {});
  assert.equal((await service.snapshot('owner-a', 'conversation-a')).contextBlocks.length, 1);
  await assert.rejects(() => service.snapshot('owner-b', 'conversation-a'), e => e.getStatus() === 404);
  assert.ok(queries.filter(q => q.sql.includes('FROM chat_traces')).every(q => q.args[0] === 'conversation-a'));
});
