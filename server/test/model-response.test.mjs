import assert from 'node:assert/strict';
import test from 'node:test';
import { AgentProtocolError, parseAgentResponse } from '../dist/ai/agent/model-response.js';
import { AgentLoop, PLANNER_PROTOCOL } from '../dist/ai/agent/agent-loop.js';
import { AgentRunner } from '../dist/ai/agent/agent-runner.js';
import { ContextBuilder } from '../dist/chat/context-builder.js';
import { ToolExecutionService } from '../dist/ai/tools/tool-execution.js';
import { ToolPolicy } from '../dist/ai/tools/tool-policy.js';
import { ChatOrchestratorService } from '../dist/chat/chat-orchestrator.service.js';
import { publicIntegrationError } from '../dist/integrations/quota-error.js';
import { PLANNER_RESPONSE_FORMAT } from '../dist/ai/agent/planner-response-format.js';

const final = (answer = '可以复用已有资料直接回答。', status = 'answered') => ({ content: JSON.stringify({ type: 'final', status, answer, citationIds: [], productIds: [] }), toolCalls: [] });
const call = (id, name, args = {}) => ({ id, name, arguments: args });
const native = (calls, commentary) => ({ content: commentary === undefined ? '' : JSON.stringify({ commentary }), toolCalls: calls });
function runtime(replies, definitions) {
  const requests = [], executions = [];
  const tools = definitions.map(({ name, canBatch = true }) => ({ name, description: name, planning: { canBatch }, inputSchema: { safeParse: args => ({ success: true, data: args }) }, execute: async args => {
    executions.push(name); return { success: true, content: '资料已获取', data: { query: args.query } };
  } }));
  const builder = new ContextBuilder();
  const llm = { model: 'test', structuredOutputMode: 'disabled', completeDetailed: async (_system, _user, _model, _purpose, options) => {
    requests.push(options); assert.deepEqual(options.responseFormat, PLANNER_RESPONSE_FORMAT);
    assert.ok(replies.length); return { ...replies.shift(), model: 'test', durationMs: 1, attempts: 1, inputTokens: 1, outputTokens: 1, totalTokens: 2 };
  } };
  const execution = new ToolExecutionService({ get: name => tools.find(tool => tool.name === name), list: () => tools }, new ToolPolicy());
  const runner = new AgentRunner(new AgentLoop(llm, builder, execution), builder);
  return { runner, requests, executions };
}
const input = { question: '介绍一下产品', summary: '', recentHistory: [] };

test('content cannot execute legacy single/batch/array/DSML/mixed instructions or repair fences', async () => {
  const rejected = [
    JSON.stringify({ type: 'tool', name: 'list_products', arguments: {} }),
    JSON.stringify({ type: 'tools', calls: [call('1', 'list_products')] }),
    JSON.stringify([call('1', 'list_products')]),
    '<｜｜DSML｜｜invoke name="list_products"></｜｜DSML｜｜invoke>',
    final().content + '\n<｜｜DSML｜｜invoke name="list_products"></｜｜DSML｜｜invoke>',
    '```json\n' + final().content + '\n```',
    '这里是答案：' + final().content,
    JSON.stringify({ commentary: '我先查询产品。' }),
    '直接返回普通文本',
  ];
  for (const content of rejected) {
    const r = runtime([{ content, toolCalls: [] }], [{ name: 'list_products' }]);
    await assert.rejects(r.runner.run(input), error => error instanceof AgentProtocolError && error.code === 'model_protocol_error');
    assert.deepEqual(r.executions, []); assert.equal(r.requests.length, 1);
  }
  assert.doesNotMatch(PLANNER_PROTOCOL, /兼容回退|"type":"tool"|"type":"tools"/);
});

test('commentary is explicitly structured, optional and never extracted from private/raw text', () => {
  const calls = [call('1', 'list_products')];
  assert.equal(parseAgentResponse(JSON.stringify({ commentary: '我先查看产品目录。' }), calls).commentary, '我先查看产品目录。');
  assert.equal(parseAgentResponse(JSON.stringify({ commentary: 'a'.repeat(161) }), calls).commentary, 'a'.repeat(161));
  for (const content of ['', '普通文字', '{bad', JSON.stringify({ commentary: 1 }), JSON.stringify({ commentary: '<think>secret</think>' }), JSON.stringify({ commentary: 'productId: internal' }), JSON.stringify({ commentary: '说明', reasoning_content: 'secret' }), JSON.stringify({ type: 'tool', name: 'list_products', arguments: {} })]) {
    const parsed = parseAgentResponse(content, calls); assert.equal(parsed.mode, 'native'); assert.equal(parsed.commentary, undefined);
  }
  assert.throws(() => parseAgentResponse('', [call('1', 'list_products'), call('1', 'search_knowledge')]), AgentProtocolError);
});

test('final metadata and answer are not rejected by arbitrary response-size caps', () => {
  const answer = 'a'.repeat(1300);
  const citationIds = Array.from({ length: 12 }, (_, index) => index + 1);
  const productIds = Array.from({ length: 75 }, (_, index) => `product-${index}`);
  const parsed = parseAgentResponse(JSON.stringify({ type: 'final', status: 'answered', answer, citationIds, productIds }));
  assert.equal(parsed.mode, 'final');
  assert.equal(parsed.final.answer, answer);
  assert.equal(parsed.final.citationIds.length, citationIds.length);
  assert.equal(parsed.final.productIds.length, productIds.length);
});

test('native batches execute sequentially, emit one model commentary before tools and retain it with native ids', async () => {
  const r = runtime([
    native([call('search-1', 'search_knowledge', { query: '产品特点' }), call('list-1', 'list_products')], '我先查询产品资料并查看目录。'),
    native([call('detail-1', 'get_product_detail', { productId: '1' })], '接下来查看这款产品的具体规格。'),
    final(),
  ], [{ name: 'search_knowledge' }, { name: 'list_products' }, { name: 'get_product_detail' }]);
  const events = [], order = [];
  const orchestrator = new ChatOrchestratorService(r.runner);
  const result = await orchestrator.askDetailed(input.question, [], '', undefined, undefined, undefined, undefined, {
    onCommentary: event => { order.push('commentary'); events.push(event); assert.equal(r.executions.length, order.filter(item => item === 'running').length); },
    onProgress: event => { order.push(event.status); events.push(event); if (event.status === 'running') assert.equal(events.at(-2)?.type === 'commentary' || r.executions.length === 1, true); },
  });
  assert.deepEqual(r.executions, ['search_knowledge', 'list_products', 'get_product_detail']);
  assert.deepEqual(order, ['commentary', 'running', 'completed', 'running', 'completed', 'commentary', 'running', 'completed']);
  assert.equal(result.result.progressEvents.filter(event => event.type === 'commentary').length, 2);
  assert.deepEqual(result.contextSnapshot.plannerParseModes, ['native', 'native', 'final']);
  const messages = r.requests[1].messages;
  assert.ok(messages.some(message => message.role === 'assistant' && JSON.parse(message.content || '{}').commentary === '我先查询产品资料并查看目录。' && message.toolCalls[0].id === 'search-1'));
  assert.deepEqual(messages.filter(message => message.role === 'tool').map(message => message.toolCallId), ['search-1', 'list-1']);
  assert.equal(result.result.answer, '可以复用已有资料直接回答。');
});

test('replanning boundary retains every native call and result instead of dropping a batch tail', async () => {
  const r = runtime([
    native([call('search', 'search_knowledge'), call('skill', 'load_skill'), call('detail', 'get_product_detail', { productId: 'one' })]),
    native([call('detail-next', 'get_product_detail', { productId: 'one' })]), final(),
  ], [{ name: 'search_knowledge' }, { name: 'load_skill', canBatch: false }, { name: 'get_product_detail' }]);
  const result = await r.runner.run(input);
  assert.deepEqual(r.executions, ['search_knowledge', 'load_skill', 'get_product_detail']);
  const steps = result.contextSnapshot.executionSteps.filter(step => step.type === 'tool_call');
  assert.deepEqual(steps.map(step => `${step.plannerRound}:${step.name}`), ['1:search_knowledge', '1:load_skill', '1:get_product_detail', '2:get_product_detail']);
  assert.equal(steps[2].deferred, true);
  assert.equal(steps[2].errorCode, 'tool_requires_replanning');
  const transcript = r.requests[1].messages;
  assert.deepEqual(transcript.find(m => m.role === 'assistant' && m.toolCalls)?.toolCalls.map(c => c.id), ['search', 'skill', 'detail']);
  assert.deepEqual(transcript.filter(m => m.role === 'tool').map(m => m.toolCallId), ['search', 'skill', 'detail']);
  assert.equal(JSON.parse(transcript.find(m => m.toolCallId === 'detail').content).requiresReplanning, true);
  assert.equal(steps[3].ok, true, 'deferred arguments are not poisoned by duplicate protection');
  assert.equal(result.result.refused, false);
});

test('direct answer/refusal need no tools or commentary; failures have a different public error code', async () => {
  for (const status of ['answered', 'refused']) {
    const r = runtime([final('请补充具体型号，我可以继续帮助你。', status)], []);
    const result = await r.runner.run(input, { onCommentary: () => assert.fail('no commentary') });
    assert.equal(result.result.refused, status === 'refused'); assert.equal(r.requests.length, 1);
  }
  const r = runtime([{ content: 'invalid', toolCalls: [] }], []);
  await assert.rejects(new ChatOrchestratorService(r.runner).askDetailed(input.question, [], ''), error => {
    assert.deepEqual(publicIntegrationError(error), { status: 502, code: 'model_protocol_error', message: '模型响应格式异常，本轮未完成，请稍后重试。' });
    return error.getStatus() === 502;
  });
});
