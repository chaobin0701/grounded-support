import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';
import { AgentLoop, PLANNER_PROTOCOL } from '../dist/ai/agent/agent-loop.js';
import { AgentRunner } from '../dist/ai/agent/agent-runner.js';
import { ContextBuilder } from '../dist/chat/context-builder.js';
import { DEFAULT_AGENT_CONFIGURATION, parseAgentConfiguration } from '../dist/config/agent-config.js';
import { ToolRegistry } from '../dist/ai/tools/tool-registry.js';
import { ToolPolicy } from '../dist/ai/tools/tool-policy.js';
import { ToolExecutionService } from '../dist/ai/tools/tool-execution.js';
import { ProductDetailTool } from '../dist/ai/tools/product-catalog/product-detail.tool.js';
import { LoadSkillTool } from '../dist/ai/tools/load-skill.tool.js';
import { SkillRegistry } from '../dist/ai/skills/skill-registry.js';
import { productConsultationSkill } from '../dist/ai/skills/built-in/product-consultation.skill.js';
import { AdminDebugService } from '../dist/chat/admin-debug.service.js';

const call = (id, name, args = {}) => ({ id, name, arguments: args });
const batch = calls => ({ content: JSON.stringify({ commentary: '我先查询这些产品的详细资料。' }), toolCalls: calls });
const final = () => ({ content: JSON.stringify({ type: 'final', status: 'answered', answer: '已查询可用资料，缺失部分仍需进一步确认。', citationIds: [], productIds: [] }) });
const product = id => ({ id, name: `产品 ${id}`, brand: 'fixture', description: `DETAIL_${id}`, summary: '资料', categoryId: 'fixture', category: '分类', suggestedPrice: '以官方渠道为准', specifications: { 功率: '100 W' }, revision: 'v1' });
const details = ids => ids.map(id => call(`detail-${id}`, 'get_product_detail', { productId: id }));

function runtime(responses, tools, settings = {}) {
  const mutable = structuredClone(DEFAULT_AGENT_CONFIGURATION);
  Object.assign(mutable.runtime, settings);
  const config = { agent: parseAgentConfiguration(mutable) };
  const registry = new ToolRegistry(); tools.forEach(tool => registry.register(tool));
  const execution = new ToolExecutionService(registry, new ToolPolicy(config));
  const states = [], requests = [];
  const createState = execution.createStateForAgent.bind(execution);
  execution.createStateForAgent = (...args) => { const state = createState(...args); states.push(state); return state; };
  const llm = { model: 'fixture', maxOutputTokens: 1200, completeDetailed: async (system, _user, _model, _purpose, options) => {
    requests.push(structuredClone({ system, ...options }));
    assert.ok(responses.length, 'Unexpected extra model planning request');
    const next = responses.shift();
    const reply = typeof next === 'function' ? next(requests.at(-1), states[0]) : next;
    return { ...reply, model: 'fixture', durationMs: 1, attempts: 1, inputTokens: 1, outputTokens: 1, totalTokens: 2 };
  } };
  const builder = new ContextBuilder(config);
  const runner = new AgentRunner(new AgentLoop(llm, builder, execution, undefined, config), builder, config);
  return { runner, requests, states, registry, execution, input: { question: '这几款产品的价格和规格是什么？', summary: '', recentHistory: [] } };
}

function assertClosedPairs(messages) {
  for (const [index, message] of messages.entries()) {
    if (message.role !== 'assistant' || !message.toolCalls?.length) continue;
    const results = messages.slice(index + 1, index + 1 + message.toolCalls.length);
    assert.deepEqual(results.map(result => [result.role, result.toolCallId]), message.toolCalls.map(c => ['tool', c.id]));
  }
}

test('one model response runs five real product-detail tools in order without parallel execution or replanning per product', async () => {
  const ids = ['one', 'two', 'three', 'four', 'five'];
  let active = 0, maximumActive = 0;
  const queried = [];
  const tool = new ProductDetailTool({ getProductDetail: async id => {
    queried.push(id); active++; maximumActive = Math.max(maximumActive, active);
    await new Promise(resolve => setImmediate(resolve)); active--;
    return product(id);
  } });
  const calls = details(ids);
  const r = runtime([batch(calls), request => {
    assertClosedPairs(request.messages);
    assert.deepEqual(request.messages.filter(m => m.role === 'tool').map(m => m.toolCallId), calls.map(c => c.id));
    const context = JSON.parse(request.messages.at(-1).content);
    assert.deepEqual(context.productContext.products.map(p => p.id), ids);
    return final();
  }], [tool]);
  const events = [], commentary = [];
  const result = await r.runner.run(r.input, { onProgress: e => events.push(e), onCommentary: e => commentary.push(e) });
  assert.deepEqual(queried, ids); assert.equal(maximumActive, 1);
  assert.equal(r.requests.length, 2); assert.equal(r.states[0].callCount, 5);
  assert.equal(commentary.length, 1); assert.equal(events.length, 10);
  assert.deepEqual(result.toolCalls.map(c => c.ok), Array(5).fill(true));
  const steps = result.contextSnapshot.executionSteps.filter(s => s.type === 'tool_call');
  assert.deepEqual(steps.map(s => s.plannerRound), Array(5).fill(1));
  assert.deepEqual(steps.map(s => s.toolIndex), [0, 1, 2, 3, 4]);
  assert.equal(new Set(steps.map(s => s.toolBatchId)).size, 1);
  assert.equal(result.result.refused, false);
  assert.match(r.requests[0].system, /同一个工具也可以使用不同参数调用多次/);
  assert.doesNotMatch(r.requests[0].system, /get_product_detail: 单独返回/);
});

test('invalid, missing and throwing detail queries retain native results and do not stop other independent tasks', async () => {
  const queried = [];
  const tool = new ProductDetailTool({ getProductDetail: async id => {
    queried.push(id);
    if (id === 'missing') return null;
    if (id === 'throw') throw new Error('PRIVATE_DATABASE_DETAILS');
    return product(id);
  } });
  const calls = [call('invalid', tool.name, { productId: '' }), ...details(['missing', 'throw', 'one', 'two'])];
  const r = runtime([batch(calls), final()], [tool]);
  const result = await r.runner.run(r.input);
  assert.deepEqual(queried, ['missing', 'throw', 'one', 'two']);
  assert.deepEqual(result.toolCalls.map(c => c.errorCode || 'ok'), ['invalid_arguments', 'product_not_found', 'tool_execution_failed', 'ok', 'ok']);
  assertClosedPairs(r.requests[1].messages);
  assert.deepEqual(r.requests[1].messages.filter(m => m.role === 'tool').map(m => m.toolCallId), calls.map(c => c.id));
  assert.doesNotMatch(JSON.stringify(r.requests), /PRIVATE_DATABASE_DETAILS/);
  assert.equal(result.result.refused, false);
});

test('a multi-tool response never bypasses the per-run call budget or drops over-budget call ids', async () => {
  const queried = [];
  const tool = new ProductDetailTool({ getProductDetail: async id => { queried.push(id); return product(id); } });
  const calls = details(['one', 'two', 'three', 'four', 'five']);
  const r = runtime([batch(calls), final()], [tool], { maxToolCalls: 2 });
  const result = await r.runner.run(r.input);
  assert.deepEqual(queried, ['one', 'two']); assert.equal(r.states[0].callCount, 2);
  assert.deepEqual(result.toolCalls.map(c => c.errorCode || 'ok'), ['ok', 'ok', 'tool_call_limit_exceeded', 'tool_call_limit_exceeded', 'tool_call_limit_exceeded']);
  assertClosedPairs(r.requests[1].messages);
  assert.equal(r.requests[1].messages.filter(m => m.role === 'tool').length, 5);
  assert.equal(result.result.refused, false);
});

test('disallowed, unknown and duplicate calls get explicit results while the rest of the batch continues', async () => {
  const queried = [];
  const search = { name: 'search_knowledge', description: 'search', planning: { canBatch: true }, inputSchema: z.object({ query: z.string() }), execute: async args => {
    queried.push(args.query); return { success: true, content: '查询完成', data: { hits: [] } };
  } };
  const calls = [call('denied', 'get_product_detail', { productId: 'one' }), call('unknown', 'missing_tool'), call('first', search.name, { query: '资料一' }), call('duplicate', search.name, { query: '资料一' }), call('second', search.name, { query: '资料二' })];
  const r = runtime([batch(calls), final()], [search], { allowedTools: ['search_knowledge', 'missing_tool'] });
  const result = await r.runner.run(r.input);
  assert.deepEqual(queried, ['资料一', '资料二']);
  assert.deepEqual(result.toolCalls.map(c => c.errorCode || 'ok'), ['tool_not_allowed', 'unknown_tool', 'ok', 'duplicate_tool_call', 'ok']);
  assertClosedPairs(r.requests[1].messages);
  assert.equal(result.result.refused, false);
});

test('Skill-first batches explicitly defer subsequent calls without charging or poisoning them, then execute after reading guidance', async () => {
  const skills = new SkillRegistry(); skills.register(productConsultationSkill);
  const queried = [];
  const skill = new LoadSkillTool(skills);
  const detail = new ProductDetailTool({ getProductDetail: async id => { queried.push(id); return product(id); } });
  const calls = [call('skill', skill.name, { skillId: productConsultationSkill.id }), ...details(['one', 'two'])];
  const r = runtime([batch(calls), (request, state) => {
    assertClosedPairs(request.messages);
    assert.ok(request.system.includes(productConsultationSkill.systemInstructions));
    assert.equal(state.callCount, 1);
    for (const id of ['one', 'two']) assert.equal(state.seenCalls.has(JSON.stringify({ name: detail.name, arguments: { productId: id } })), false);
    const results = request.messages.filter(m => m.role === 'tool').slice(1).map(m => JSON.parse(m.content));
    assert.ok(results.every(result => result.error === 'tool_requires_replanning' && result.requiresReplanning));
    return batch(['one', 'two'].map(id => call(`retry-${id}`, detail.name, { productId: id })));
  }, final()], [skill, detail]);
  const events = [];
  const result = await r.runner.run({ ...r.input, availableSkills: skills.summaries() }, { onProgress: e => events.push(e) });
  assert.deepEqual(queried, ['one', 'two']); assert.equal(r.states[0].callCount, 3);
  assert.equal(result.toolCalls.filter(c => c.deferred).length, 2);
  assert.equal(events.length, 6, 'only actual attempts emit tool progress, not deferred placeholder results');
  assertClosedPairs(r.requests[2].messages);
  assert.equal(result.loadedSkills[0].id, productConsultationSkill.id);
  assert.equal(result.result.refused, false);
});

test('a successful Skill at the end is executed, and a failed Skill does not force unrelated reads to defer', async () => {
  const skills = new SkillRegistry(); skills.register(productConsultationSkill);
  const skill = new LoadSkillTool(skills);
  for (const skillId of [productConsultationSkill.id, 'unknown_skill']) {
    const queried = [];
    const detail = new ProductDetailTool({ getProductDetail: async id => { queried.push(id); return product(id); } });
    const calls = skillId === 'unknown_skill'
      ? [call('skill', skill.name, { skillId }), ...details(['one'])]
      : [...details(['one']), call('skill', skill.name, { skillId })];
    const r = runtime([batch(calls), final()], [skill, detail]);
    const result = await r.runner.run({ ...r.input, availableSkills: skills.summaries() });
    assert.deepEqual(queried, ['one']); assert.equal(r.states[0].callCount, 2);
    assert.equal(result.toolCalls.some(c => c.deferred), false);
    assertClosedPairs(r.requests[1].messages);
    assert.equal(result.result.refused, false);
  }
});

test('successful repeat product references reuse one lookup within a batch while preserving every native id', async () => {
  let queried = 0;
  const detail = new ProductDetailTool({ getProductDetail: async id => { queried++; return product(id); } });
  const r = runtime([batch([call('one', detail.name, { productId: 'one' }), call('repeat', detail.name, { productId: 'one' })]), final()], [detail]);
  const result = await r.runner.run(r.input);
  assert.equal(queried, 1); assert.equal(r.states[0].callCount, 1);
  assert.equal(result.toolCalls[1].reused, true);
  assertClosedPairs(r.requests[1].messages);
  assert.equal(JSON.stringify(r.requests[1].messages).split('DETAIL_one').length - 1, 1);
  assert.equal(result.result.refused, false);
  assert.match(PLANNER_PROTOCOL, /不要求每轮调用工具/);
});

test('expected replanning placeholders are not diagnosed as failed, duplicate or over-budget tool executions', () => {
  const deferred = { type: 'tool_call', name: 'get_product_detail', arguments: { productId: 'one' }, ok: false, deferred: true, errorCode: 'tool_requires_replanning' };
  const contextSnapshot = { executionSteps: [
    { type: 'tool_call', name: 'load_skill', arguments: { skillId: 'product_consultation' }, ok: true },
    ...Array.from({ length: 4 }, () => ({ ...deferred })),
    { type: 'tool_call', name: 'get_product_detail', arguments: { productId: 'one' }, ok: true },
  ] };
  const conversation = { id: 'fixture', messages: [{ id: 1, role: 'user', content: '查询产品' }, { id: 2, role: 'assistant', content: '产品资料', citations: [], progressEvents: [] }], runs: [], traces: [{ id: 'fixture-trace', status: 'completed', userMessageId: 1, finalAnswer: '产品资料', durationMs: 1, contextSnapshot }] };
  const findings = new AdminDebugService({}).diagnoseConversation(conversation);
  assert.ok(findings.every(f => !['tool_failed', 'duplicate_tool_call', 'tool_call_limit_risk'].includes(f.code)));
});
