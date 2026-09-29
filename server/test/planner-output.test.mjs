import assert from 'node:assert/strict';
import test from 'node:test';
import { parsePlannerOutput } from '../dist/ai/agent/planner-output.js';
import { AgentLoop } from '../dist/ai/agent/agent-loop.js';
import { AgentRunner } from '../dist/ai/agent/agent-runner.js';
import { ContextBuilder } from '../dist/chat/context-builder.js';
import { ToolExecutionService } from '../dist/ai/tools/tool-execution.js';
import { ToolPolicy } from '../dist/ai/tools/tool-policy.js';

test('planner accepts JSON followed by a duplicate DSML invocation', () => {
  const output = [
    '{"type":"tool","name":"list_products","arguments":{}}',
    '<｜｜DSML｜｜ calls>',
    '<｜｜DSML｜｜ invoke name="list_products">',
    '</｜｜DSML｜｜ invoke>',
    '</｜｜DSML｜｜ calls>',
  ].join('\n');
  const parsed = parsePlannerOutput(output);
  assert.equal(parsed.parseMode, 'json_with_dsml');
  assert.deepEqual(parsed.toolCalls, [{ type: 'tool', name: 'list_products', arguments: {} }]);
});

test('planner parses multiple DSML invocations and their parameters', () => {
  const output = [
    '<｜｜DSML｜｜ calls>',
    '<｜｜DSML｜｜ invoke name="search_knowledge">',
    '<｜｜DSML｜｜ parameter name="query">暖风机 H2</｜｜DSML｜｜ parameter>',
    '</｜｜DSML｜｜ invoke>',
    '<｜｜DSML｜｜ invoke name="list_products">',
    '</｜｜DSML｜｜ invoke>',
    '</｜｜DSML｜｜ calls>',
  ].join('\n');
  const parsed = parsePlannerOutput(output);
  assert.equal(parsed.parseMode, 'dsml');
  assert.deepEqual(parsed.toolCalls, [
    { type: 'tool', name: 'search_knowledge', arguments: { query: '暖风机 H2' } },
    { type: 'tool', name: 'list_products', arguments: {} },
  ]);
});

test('agent executes a batch of JSON tool calls before asking the planner again', async () => {
  const hit = {
    chunkId: 12, documentId: 3, documentTitle: '产品资料', originalFilename: 'products.md',
    ordinal: 0, headingPath: '暖风机', content: '暖巢 H2 适合卧室使用。', sourceStartLine: 1, sourceEndLine: 2, score: 0.86,
  };
  const responses = [
    JSON.stringify([
      { type: 'tool', name: 'search_knowledge', arguments: { query: '暖风机 H2' } },
      { type: 'tool', name: 'list_products', arguments: { query: '暖风机 H2' } },
    ]),
    JSON.stringify({ type: 'final', status: 'answered', answer: '暖巢 H2 适合卧室使用。', citationIds: [12], productIds: ['heater-h2'] }),
  ];
  const llm = {
    model: 'test-model',
    completeDetailed: async () => ({ content: responses.shift(), model: 'test-model', inputTokens: 10, outputTokens: 5, totalTokens: 15 }),
  };
  const tools = new Map([
    ['search_knowledge', {
      name: 'search_knowledge', description: 'search', inputSchema: { safeParse: (input) => ({ success: true, data: input }) },
      execute: async () => ({ success: true, content: '产品资料', data: { hits: [hit] } }),
    }],
    ['list_products', {
      name: 'list_products', description: 'products', inputSchema: { safeParse: (input) => ({ success: true, data: input }) },
      execute: async () => ({ success: true, content: '产品目录', data: { products: [{ id: 'heater-h2', name: '暖巢 H2' }] } }),
    }],
  ]);
  const registry = { get: (name) => tools.get(name) };
  const execution = new ToolExecutionService(registry, new ToolPolicy());
  const runner = new AgentRunner(new AgentLoop(llm, new ContextBuilder(), execution), new ContextBuilder());
  const result = await runner.run({ question: '介绍暖风机 H2', summary: '', recentHistory: [] });

  assert.equal(result.result.refused, false);
  assert.equal(result.toolCalls.length, 2);
  assert.deepEqual(result.toolCalls.map((call) => call.name), ['search_knowledge', 'list_products']);
  assert.equal(result.contextSnapshot.plannerParseMode, 'json');
  const steps = result.contextSnapshot.executionSteps;
  const toolSteps = steps.filter((step) => step.type === 'tool_call');
  assert.deepEqual(toolSteps.map((step) => step.plannerRound), [1, 1]);
  assert.equal(toolSteps[0].toolBatchId, 'planner-1-tools');
  assert.equal(toolSteps[1].toolBatchId, 'planner-1-tools');
  assert.deepEqual(toolSteps.map((step) => step.toolIndex), [0, 1]);
  assert.equal(steps.filter((step) => step.type === 'llm_call').at(-1).plannerRound, 2);
});

test('agent defers a dependent tool to the next planner round', async () => {
  const hit = {
    chunkId: 12, documentId: 3, documentTitle: '产品资料', originalFilename: 'products.md',
    ordinal: 0, headingPath: '暖风机', content: '暖巢 H2 适合卧室使用。', sourceStartLine: 1, sourceEndLine: 2, score: 0.86,
  };
  const responses = [
    JSON.stringify([
      { type: 'tool', name: 'search_knowledge', arguments: { query: '暖风机 H2' } },
      { type: 'tool', name: 'get_product_detail', arguments: { productId: 'heater-h2' } },
    ]),
    JSON.stringify({ type: 'tool', name: 'get_product_detail', arguments: { productId: 'heater-h2' } }),
    JSON.stringify({ type: 'final', status: 'answered', answer: '暖巢 H2 适合卧室使用。', citationIds: [12], productIds: [] }),
  ];
  const llm = {
    model: 'test-model',
    completeDetailed: async () => ({ content: responses.shift(), model: 'test-model', inputTokens: 10, outputTokens: 5, totalTokens: 15 }),
  };
  const tools = new Map([
    ['search_knowledge', {
      name: 'search_knowledge', description: 'search', planning: { canBatch: true }, inputSchema: { safeParse: (input) => ({ success: true, data: input }) },
      execute: async () => ({ success: true, content: '产品资料', data: { hits: [hit] } }),
    }],
    ['get_product_detail', {
      name: 'get_product_detail', description: 'detail', planning: { canBatch: false }, inputSchema: { safeParse: (input) => ({ success: true, data: input }) },
      execute: async () => ({ success: true, content: '产品详情', data: {} }),
    }],
  ]);
  const registry = { get: (name) => tools.get(name) };
  const execution = new ToolExecutionService(registry, new ToolPolicy());
  const runner = new AgentRunner(new AgentLoop(llm, new ContextBuilder(), execution), new ContextBuilder());
  const result = await runner.run({ question: '介绍暖风机 H2', summary: '', recentHistory: [] });

  assert.equal(result.result.refused, false);
  const toolSteps = result.contextSnapshot.executionSteps.filter((step) => step.type === 'tool_call');
  assert.deepEqual(toolSteps.map((step) => `${step.plannerRound}:${step.name}`), [
    '1:search_knowledge',
    '2:get_product_detail',
  ]);
  assert.notEqual(toolSteps[0].toolBatchId, toolSteps[1].toolBatchId);
});
