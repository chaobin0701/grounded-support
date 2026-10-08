import assert from 'node:assert/strict';
import test from 'node:test';
import { KnowledgeSearchTool } from '../dist/ai/tools/knowledge-search.tool.js';
import { ChatOrchestratorService } from '../dist/chat/chat-orchestrator.service.js';
import { ContextBuilder } from '../dist/chat/context-builder.js';
import { AgentLoop } from '../dist/ai/agent/agent-loop.js';
import { AgentRunner } from '../dist/ai/agent/agent-runner.js';
import { ToolExecutionService } from '../dist/ai/tools/tool-execution.js';
import { ToolPolicy } from '../dist/ai/tools/tool-policy.js';

const hit = {
  chunkId: 12, documentId: 3, documentTitle: '退货政策', originalFilename: 'returns.md',
  ordinal: 0, headingPath: '退货条件', content: '七天内可申请退货。', sourceStartLine: 2, sourceEndLine: 4, score: 0.86,
};

test('public operation descriptions precede tool execution and never expose model content, arguments or results', async t => {
  for (const protocol of ['native']) {
    for (const [name, text] of [['list_product_categories', '正在查看产品分类'], ['list_products', '正在查看产品目录'], ['get_product_detail', '正在读取产品详细规格']]) {
      await t.test(`${protocol}: ${name}`, async () => {
        const events = [], order = [];
        const arguments_ = { productId: 'PRIVATE_PRODUCT_ID', query: 'PRIVATE_QUERY' };
        const replies = [
          { content: 'PRIVATE_MODEL_CONTENT', toolCalls: [{ id: 'call1', name, arguments: arguments_ }] },
          { content: JSON.stringify({ type: 'final', status: 'answered', answer: '查询完成。', citationIds: [], productIds: [] }), toolCalls: [] },
        ];
        const llm = { model: 'test-model', completeDetailed: async () => ({ ...replies.shift(), model: 'test-model', inputTokens: 1, outputTokens: 1, totalTokens: 2 }) };
        const tool = { name, description: 'test', inputSchema: { safeParse: input => ({ success: true, data: input }) }, execute: async () => {
          assert.equal(events.length, 1);
          assert.equal(events[0].status, 'running');
          assert.equal(events[0].text, text);
          order.push('execute');
          return { success: true, content: 'PRIVATE_TOOL_RESULT', data: {} };
        } };
        const execution = new ToolExecutionService({ get: () => tool, list: () => [tool] }, new ToolPolicy());
        const builder = new ContextBuilder();
        const runner = new AgentRunner(new AgentLoop(llm, builder, execution), builder);
        const result = await runner.run({ question: '产品资料是什么？', summary: '', recentHistory: [] }, { onProgress: event => { events.push(event); order.push(event.status); } });
        assert.equal(result.result.refused, false);
        assert.deepEqual(order, ['running', 'execute', 'completed']);
        assert.equal(events[0].operationId, events[1].operationId);
        assert.equal(typeof events[1].durationMs, 'number'); // Backend diagnostics remain available.
        assert.doesNotMatch(JSON.stringify(events), /PRIVATE_/);
      });
    }
  }
});

test('knowledge search tool separates model content from backend evidence data', async () => {
  let requestedTopK = null;
  const search = {
    searchForAgent: async (query, topK) => {
      assert.equal(query, '退货政策');
      requestedTopK = topK;
      return { hits: [hit], retrievalMode: 'hybrid', vectorIndexedChunks: 4 };
    },
  };
  const tool = new KnowledgeSearchTool(search);
  const parsed = tool.inputSchema.safeParse({ query: '退货政策', topK: 3 });
  assert.equal(parsed.success, true);
  const result = await tool.execute(parsed.data, { permissions: [], state: new Map() });
  assert.equal(requestedTopK, 3);
  assert.match(result.content, /\[12\] 退货政策/);
  assert.deepEqual(result.data.hits, [hit]);
  assert.equal(result.data.lexicalResults, undefined);
  assert.equal(result.metadata.retrievalMode, 'hybrid');
  assert.equal(tool.inputSchema.safeParse({ query: '退货政策', topK: 9 }).success, false);
});

test('agent refuses repeated identical tool calls instead of looping', async () => {
  let nextCallId = 0;
  const llm = {
    model: 'test-model',
    completeDetailed: async () => ({ content: '', toolCalls: [{ id: `search-${nextCallId++}`, name: 'search_knowledge', arguments: { query: '退货政策' } }], model: 'test-model', inputTokens: null, outputTokens: null, totalTokens: null }),
  };
  const tool = {
    name: 'search_knowledge',
    description: 'search',
    inputSchema: { safeParse: (input) => ({ success: true, data: input }) },
    execute: async () => ({ success: true, content: '退货政策：七天内可申请退货。', data: { hits: [hit] } }),
  };
  const registry = { get: () => tool };
  const contextBuilder = new ContextBuilder();
  const execution = new ToolExecutionService(registry, new ToolPolicy());
  const runner = new AgentRunner(new AgentLoop(llm, contextBuilder, execution), contextBuilder);
  const orchestrator = new ChatOrchestratorService(runner);
  const run = await orchestrator.askDetailed('退货政策是什么？', [], '');
  assert.equal(run.result.refused, true);
  assert.equal(run.contextSnapshot.toolCalls[1].errorCode, 'duplicate_tool_call');
});

test('agent runner returns a normalized result after a tool step', async () => {
  const responses = [
    { content: '', toolCalls: [{ id: 'search-1', name: 'search_knowledge', arguments: { query: '退货政策' } }] },
    { content: JSON.stringify({ type: 'final', status: 'answered', answer: '七天内可申请退货。', citationIds: [12], productIds: [] }), toolCalls: [] },
  ];
  const llm = {
    model: 'test-model',
    completeDetailed: async () => ({ ...responses.shift(), model: 'test-model', inputTokens: 10, outputTokens: 5, totalTokens: 15 }),
  };
  const tool = {
    name: 'search_knowledge',
    description: 'search',
    inputSchema: { safeParse: (input) => ({ success: true, data: input }) },
    execute: async () => ({ success: true, content: '退货政策：七天内可申请退货。', data: { hits: [hit] } }),
  };
  const registry = { get: () => tool };
  const contextBuilder = new ContextBuilder();
  const execution = new ToolExecutionService(registry, new ToolPolicy());
  const runner = new AgentRunner(new AgentLoop(llm, contextBuilder, execution), contextBuilder);
  const result = await runner.run({ question: '退货政策是什么？', summary: '', recentHistory: [] });

  assert.equal(result.result.refused, false);
  assert.equal(result.result.answer, '七天内可申请退货。');
  assert.deepEqual(result.result.citations, [{
    chunkId: 12, documentId: 3, documentTitle: '退货政策', originalFilename: 'returns.md',
    sourceStartLine: 2, sourceEndLine: 4,
  }]);
  assert.equal(result.toolCalls.length, 1);
  assert.equal(result.toolResults.length, 1);
  assert.equal(result.inputTokens, 20);
  assert.equal(result.outputTokens, 10);
  assert.equal(result.totalTokens, 30);
  assert.equal(result.contextSnapshot.toolCalls.length, 1);
});

test('agent executes provider-native tool calls and preserves the call id', async () => {
  const responses = [
    { content: '', toolCalls: [{ id: 'call-native-1', name: 'search_knowledge', arguments: { query: '退货政策' } }] },
    { content: JSON.stringify({ type: 'final', status: 'answered', answer: '七天内可申请退货。', citationIds: [12], productIds: [] }), toolCalls: [] },
  ];
  const llm = {
    model: 'test-model',
    completeDetailed: async (_system, _user, _model, _purpose, options) => {
      assert.ok(options.tools.some((item) => item.name === 'search_knowledge'));
      assert.deepEqual(options.responseFormat, { type: 'json_object' });
      return { ...responses.shift(), model: 'test-model', inputTokens: 1, outputTokens: 1, totalTokens: 2 };
    },
  };
  const tool = {
    name: 'search_knowledge',
    description: 'search',
    inputSchema: { safeParse: (input) => ({ success: true, data: input }) },
    execute: async () => ({ success: true, content: '退货政策：七天内可申请退货。', data: { hits: [hit] } }),
  };
  const registry = { get: () => tool, list: () => [tool] };
  const execution = new ToolExecutionService(registry, new ToolPolicy());
  const runner = new AgentRunner(new AgentLoop(llm, new ContextBuilder(), execution), new ContextBuilder());
  const result = await runner.run({ question: '退货政策是什么？', summary: '', recentHistory: [] });

  assert.equal(result.result.refused, false);
  assert.equal(result.toolCalls[0].name, 'search_knowledge');
  assert.equal(result.contextSnapshot.agentTranscript.find((item) => item.role === 'tool').toolCallId, 'call-native-1');
  assert.deepEqual(result.contextSnapshot.plannerParseModes, ['native', 'final']);
});

test('agent can recover from a tool failure on the next planner round', async () => {
  const responses = [
    { content: '', toolCalls: [{ id: 'detail-1', name: 'get_product_detail', arguments: { productId: 'known-product' } }] },
    { content: JSON.stringify({ type: 'final', status: 'answered', answer: '我已经找到产品目录中的基础信息。', citationIds: [], productIds: [] }), toolCalls: [] },
  ];
  const llm = {
    model: 'test-model',
    completeDetailed: async () => ({ ...responses.shift(), model: 'test-model', inputTokens: 1, outputTokens: 1, totalTokens: 2 }),
  };
  const tool = {
    name: 'get_product_detail',
    description: 'detail',
    inputSchema: { safeParse: (input) => ({ success: true, data: input }) },
    execute: async () => ({ success: false, content: 'PRODUCT_NOT_FOUND', errorCode: 'product_not_found' }),
  };
  const registry = { get: () => tool, list: () => [tool] };
  const execution = new ToolExecutionService(registry, new ToolPolicy());
  const runner = new AgentRunner(new AgentLoop(llm, new ContextBuilder(), execution), new ContextBuilder());
  const result = await runner.run({ question: '介绍这个产品', summary: '', recentHistory: [] });

  assert.equal(result.result.refused, false);
  assert.equal(result.result.answer, '我已经找到产品目录中的基础信息。');
  assert.equal(result.contextSnapshot.toolCalls[0].errorCode, 'product_not_found');
});

test('unified agent answers a greeting without preflight or citation', async () => {
  const llm = {
    model: 'test-model',
    completeDetailed: async () => ({
      content: JSON.stringify({
        type: 'final',
        status: 'answered',
        answer: '你好啊，我可以帮你查询产品和售后资料。',
        citationIds: [],
        productIds: [],
      }),
      model: 'test-model',
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
    }),
  };
  const registry = { get: () => { throw new Error('tool should not be called'); } };
  const contextBuilder = new ContextBuilder();
  const execution = new ToolExecutionService(registry, new ToolPolicy());
  const runner = new AgentRunner(new AgentLoop(llm, contextBuilder, execution), contextBuilder);
  const result = await runner.run({ question: '你好啊', summary: '', recentHistory: [] });

  assert.equal(result.result.refused, false);
  assert.equal(result.result.answer, '你好啊，我可以帮你查询产品和售后资料。');
  assert.equal(result.contextSnapshot.skill, undefined);
  assert.deepEqual(result.contextSnapshot.loadedSkills, []);
  assert.equal(result.contextSnapshot.executionSteps.some(step => step.type === 'skill_selection'), false);
  assert.equal(result.contextSnapshot.executionSteps.some((step) => step.type === 'preflight'), false);
  assert.equal(result.contextSnapshot.toolCalls.length, 0);
});
