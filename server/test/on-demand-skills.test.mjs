import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';
import { AgentLoop } from '../dist/ai/agent/agent-loop.js';
import { AgentRunner } from '../dist/ai/agent/agent-runner.js';
import { validateAgentAnswer } from '../dist/ai/agent/agent-answer.js';
import { SkillRegistry } from '../dist/ai/skills/skill-registry.js';
import { productConsultationSkill } from '../dist/ai/skills/built-in/product-consultation.skill.js';
import { customerSupportSkill } from '../dist/ai/skills/built-in/customer-support.skill.js';
import { LoadSkillTool } from '../dist/ai/tools/load-skill.tool.js';
import { ToolRegistry } from '../dist/ai/tools/tool-registry.js';
import { ToolExecutionService } from '../dist/ai/tools/tool-execution.js';
import { ToolPolicy } from '../dist/ai/tools/tool-policy.js';
import { ContextBuilder } from '../dist/chat/context-builder.js';
import { ChatOrchestratorService } from '../dist/chat/chat-orchestrator.service.js';
import { AdminChatTraceController } from '../dist/chat/admin-chat-trace.controller.js';
import { DEFAULT_AGENT_CONFIGURATION, parseAgentConfiguration } from '../dist/config/agent-config.js';

const product = { id: 'catalog-h2', name: 'H2', specifications: { 额定功率: '1500 W' } };
const final = (answer = 'H2 的额定功率为 1500 W。') => ({ type: 'final', status: 'answered', answer, citationIds: [], productIds: [] });
const native = (id, name, args) => ({ content: '', toolCalls: [{ id, name, arguments: args }] });

function runtime(responses, { allowedTools, maxToolCalls, maxPlannerRounds } = {}) {
  const agent = structuredClone(DEFAULT_AGENT_CONFIGURATION);
  Object.assign(agent.runtime, { ...(allowedTools ? { allowedTools } : {}), ...(maxToolCalls ? { maxToolCalls } : {}), ...(maxPlannerRounds ? { maxPlannerRounds } : {}) });
  const config = { agent: parseAgentConfiguration(agent) };
  const skills = new SkillRegistry();
  skills.register(productConsultationSkill); skills.register(customerSupportSkill);
  const tools = new ToolRegistry();
  tools.register(new LoadSkillTool(skills));
  const executed = [];
  for (const [name, data] of [['list_products', { products: [product], total: 1 }], ['get_product_detail', product], ['search_knowledge', { hits: [] }]]) {
    tools.register({ name, description: name, inputSchema: z.record(z.string(), z.unknown()), execute: async args => {
      executed.push({ name, args }); return { success: true, content: JSON.stringify(data), data };
    } });
  }
  const modelRequests = [];
  const llm = { model: 'test', maxOutputTokens: 1200, completeDetailed: async (system, user, _model, _purpose, options) => {
    modelRequests.push({ system, context: JSON.parse(user), options });
    const response = responses.shift(); assert.ok(response, 'Unexpected extra planner call');
    const value = typeof response === 'function' ? response(modelRequests.at(-1)) : response;
    return { content: JSON.stringify(value), model: 'test', inputTokens: 10, outputTokens: 5, totalTokens: 15, attempts: 1, durationMs: 1, ...('content' in value ? value : {}) };
  } };
  const builder = new ContextBuilder(config);
  const loop = new AgentLoop(llm, builder, new ToolExecutionService(tools, new ToolPolicy(config)), undefined, config);
  const runner = new AgentRunner(loop, builder, config);
  const input = { question: '介绍 H2', summary: '', recentHistory: [], availableSkills: skills.summaries() };
  return { runner, input, modelRequests, executed, skills, loop };
}

test('greetings in different languages can finish without classification, retrieval or a Skill', async () => {
  for (const question of ['你好啊', 'Hello there', 'こんにちは', 'Hola']) {
    const r = runtime([final('你好，有什么可以帮你？')]);
    const result = await r.runner.run({ ...r.input, question });
    assert.equal(result.result.refused, false);
    assert.equal(r.modelRequests.length, 1);
    assert.deepEqual(result.toolCalls, []);
    assert.deepEqual(result.loadedSkills, []);
    assert.equal(result.contextSnapshot.skill, undefined);
    assert.equal(result.contextSnapshot.skillSelection, undefined);
    assert.deepEqual(result.contextSnapshot.executionSteps.map(step => step.type), ['agent_setup', 'llm_call', 'validation']);
    assert.equal(r.modelRequests[0].context.skill, undefined);
    assert.deepEqual(r.modelRequests[0].context.loadedSkills, []);
    assert.ok(r.modelRequests[0].options.tools.some(tool => tool.name === 'load_skill'));
    assert.ok(r.modelRequests[0].system.includes(DEFAULT_AGENT_CONFIGURATION.answeringInstructions));
    assert.ok(!r.modelRequests[0].system.includes(productConsultationSkill.systemInstructions));
  }
});

test('basic product lookup bypasses specialist loading and preserves the native call transcript', async () => {
  const r = runtime([native('list-1', 'list_products', {}), native('detail-1', 'get_product_detail', { productId: product.id }), final()]);
  const result = await r.runner.run(r.input);
  assert.equal(result.result.refused, false);
  assert.deepEqual(result.toolCalls.map(call => call.name), ['list_products', 'get_product_detail']);
  assert.deepEqual(result.loadedSkills, []);
  assert.ok(r.modelRequests[1].options.messages.some(message => message.role === 'tool' && message.toolCallId === 'list-1'));
  assert.ok(r.modelRequests[2].context.toolResults.some(tool => tool.tool === 'get_product_detail'));
});

test('model reads a Skill only when requested, and the next planner receives its detailed guidance', async () => {
  const r = runtime([native('skill-1', 'load_skill', { skillId: productConsultationSkill.id }), native('list-1', 'list_products', {}), final()]);
  const progress = [];
  const result = await r.runner.run(r.input, { onProgress: event => progress.push(event) });
  assert.equal(result.result.refused, false);
  assert.ok(!r.modelRequests[0].system.includes(productConsultationSkill.systemInstructions));
  assert.ok(r.modelRequests[1].system.includes(productConsultationSkill.systemInstructions));
  assert.equal(r.modelRequests[1].context.loadedSkills[0].instructions, productConsultationSkill.systemInstructions);
  assert.ok(r.modelRequests[1].options.messages.some(message => message.toolCallId === 'skill-1'));
  assert.equal(result.loadedSkills[0].id, productConsultationSkill.id);
  assert.deepEqual(result.contextSnapshot.runtime.allowedTools, DEFAULT_AGENT_CONFIGURATION.runtime.allowedTools);
  const steps = result.contextSnapshot.executionSteps;
  assert.ok(steps.findIndex(step => step.type === 'tool_call' && step.name === 'load_skill') < steps.findIndex(step => step.type === 'skill_loaded'));
  assert.equal(steps.find(step => step.type === 'skill_loaded').selectedBy, 'model');
  assert.ok(progress.every(event => !JSON.stringify(event).includes(productConsultationSkill.systemInstructions)));
  assert.deepEqual(progress.filter(event => event.tool === 'load_skill').map(event => event.status), ['running', 'completed']);
});

test('invalid or unknown Skill requests become tool results and let the model recover', async () => {
  for (const [skillId, errorCode] of [['missing_skill', 'unknown_skill'], ['../../etc/passwd', 'invalid_arguments']]) {
    const r = runtime([native('invalid-1', 'load_skill', { skillId }), final('可以直接根据已有上下文回复。')]);
    const result = await r.runner.run(r.input);
    assert.equal(result.result.refused, false);
    assert.equal(result.toolCalls[0].errorCode, errorCode);
    assert.deepEqual(result.loadedSkills, []);
    assert.equal(r.modelRequests[1].context.toolResults[0].result.error, errorCode);
  }
});

test('loaded Skill cannot expand runtime permissions or bypass the independent tool cap', async () => {
  const r = runtime([native('skill-1', 'load_skill', { skillId: productConsultationSkill.id }), native('forbidden-1', 'get_product_detail', { productId: product.id }), final('当前不能读取该产品详情，请补充资料。')], { allowedTools: ['load_skill', 'list_products'] });
  const result = await r.runner.run(r.input);
  assert.equal(result.result.refused, false);
  assert.equal(result.toolCalls[1].errorCode, 'tool_not_allowed');
  assert.deepEqual(r.executed, []);
  for (const request of r.modelRequests) assert.deepEqual(request.options.tools.map(tool => tool.name).sort(), ['list_products', 'load_skill']);

  const capped = runtime([native('skill-1', 'load_skill', { skillId: productConsultationSkill.id }), native('over-cap', 'list_products', {}), final('可以说明目前已知的内容。')], { maxToolCalls: 1, maxPlannerRounds: 3 });
  const cappedResult = await capped.runner.run(capped.input);
  assert.equal(cappedResult.toolCalls[1].errorCode, 'tool_call_limit_exceeded');
  assert.deepEqual(capped.executed, []);
  assert.equal(cappedResult.result.refused, false);
});

test('default runtime reserves a final response round after five tool calls', async () => {
  const calls = Array.from({ length: 5 }, (_, index) => native(`search-${index}`, 'search_knowledge', { query: `独立问题 ${index}` }));
  const r = runtime([...calls, final('资料未明确价格，我可以先说明已知参数。')]);
  const result = await r.runner.run(r.input);
  assert.equal(result.result.refused, false);
  assert.equal(r.modelRequests.length, 6);
  assert.equal(r.executed.length, 5);
});

test('a repeated question can reuse prior tool facts without reloading or per-turn citation refusal', async () => {
  const r = runtime([request => {
    assert.ok(request.options.messages.some(message => message.role === 'tool' && message.content.includes('1500 W')));
    return { ...final(), citationIds: [374], productIds: [product.id] };
  }]);
  const result = await r.runner.run({ ...r.input, question: '再介绍一下 H2', priorTranscript: [
    { role: 'user', content: '介绍 H2' },
    { role: 'assistant', toolCalls: [{ id: 'prior-detail', name: 'get_product_detail', arguments: { productId: product.id } }] },
    { role: 'tool', toolCallId: 'prior-detail', toolName: 'get_product_detail', content: JSON.stringify(product) },
    { role: 'assistant', content: 'H2 额定功率 1500 W。' },
  ] });
  assert.equal(result.result.refused, false);
  assert.deepEqual(result.toolCalls, []);
  assert.deepEqual(result.loadedSkills, []);
});

test('model refusal explanation survives format-only validation', () => {
  const answer = '现有资料没有该型号的价格。请提供准确型号或查看对应商品页。';
  const result = validateAgentAnswer(JSON.stringify({ type: 'final', status: 'refused', answer, citationIds: [], productIds: [] }), [], []);
  assert.equal(result.answer, answer);
  assert.equal(result.refused, true);
});

test('ordinary trace readers cannot obtain loaded Skill instructions or complete model requests', async () => {
  const secretInstructions = 'INTERNAL_SPECIALIST_GUIDANCE';
  const snapshot = { systemPrompt: secretInstructions, modelCalls: [{ request: { messages: [{ content: secretInstructions }] } }], loadedSkills: [{ id: 'product_consultation', version: '2.0.0', name: '产品咨询' }],
    toolResults: [{ tool: 'load_skill', result: secretInstructions }, { tool: 'list_products', result: 'catalog' }],
    executionSteps: [{ type: 'tool_call', name: 'load_skill', result: secretInstructions }],
    agentTranscript: [{ role: 'tool', toolName: 'load_skill', content: secretInstructions }],
  };
  const controller = new AdminChatTraceController({ query: async () => ({ rows: [{ id: 'trace', contextSnapshot: snapshot, rawModelOutput: secretInstructions }] }) });
  const detail = await controller.detail('trace');
  assert.ok(!JSON.stringify(detail).includes(secretInstructions));
  assert.equal(detail.contextSnapshot.toolResults[1].result, 'catalog');
  assert.equal(detail.contextSnapshot.loadedSkills[0].id, 'product_consultation');
  assert.equal(snapshot.agentTranscript[0].content, secretInstructions, 'original stored debug context remains intact');
});

test('orchestrator publishes the catalog without automatically preselecting or loading a Skill', async () => {
  const r = runtime([final('直接回复')]);
  const orchestrator = new ChatOrchestratorService(r.runner, {}, r.skills);
  const result = await orchestrator.askDetailed('你们有哪些产品？', [], '');
  assert.deepEqual(result.contextSnapshot.loadedSkills, []);
  assert.equal(result.contextSnapshot.availableSkills.length, 2);
  assert.equal(result.contextSnapshot.preflight, undefined);
  await assert.rejects(orchestrator.askDetailed('你好', [], '', undefined, undefined, undefined, 'question_answering'), error => error.getStatus() === 400);
});
