import assert from 'node:assert/strict';
import test from 'node:test';
import { SkillRegistry, DuplicateSkillError, UnknownSkillError } from '../dist/ai/skills/skill-registry.js';
import { SkillsModule } from '../dist/ai/skills/skills.module.js';
import { LoadSkillTool } from '../dist/ai/tools/load-skill.tool.js';
import { ToolExecutionService } from '../dist/ai/tools/tool-execution.js';
import { ToolPolicy } from '../dist/ai/tools/tool-policy.js';

function registry() {
  const registry = new SkillRegistry();
  new SkillsModule(registry).onModuleInit();
  return registry;
}

test('only specialist guides are registered; default question answering is not a Skill', () => {
  const value = registry();
  assert.deepEqual(value.list().map(skill => skill.id), ['customer_support', 'product_consultation']);
  assert.equal(value.has('question_answering'), false);
  assert.equal(value.has('small_talk'), false);
  assert.throws(() => value.register(value.get('product_consultation')), DuplicateSkillError);
  assert.throws(() => value.get('missing'), UnknownSkillError);
  assert.deepEqual(Object.keys(value.get('product_consultation')).sort(), ['description','id','name','systemInstructions','version']);
});

test('Skill summaries expose identity and descriptions without eager full instructions', () => {
  const value = registry();
  assert.equal(value.summaries().length, 2);
  for (const summary of value.summaries()) {
    assert.deepEqual(Object.keys(summary).sort(), ['description','id','name','version']);
    assert.equal(summary.systemInstructions, undefined);
    assert.equal(summary.allowedTools, undefined);
  }
});

test('load_skill reads only registered guides; no arbitrary paths or side effects', async () => {
  const value = registry();
  const tool = new LoadSkillTool(value);
  assert.equal(tool.planning.canBatch, false);
  const result = await tool.execute({skillId:'product_consultation'});
  assert.equal(result.success, true);
  assert.equal(result.data.skill.instructions, value.get('product_consultation').systemInstructions);
  assert.equal(JSON.parse(result.content).id, 'product_consultation');
  assert.equal((await tool.execute({skillId:'missing'})).errorCode, 'unknown_skill');
  for (const input of [{skillId:'../config/agent.json'}, {skillId:'/etc/passwd'}, {skillId:'product_consultation',file:'extra'}, {skillId:''}]) {
    assert.equal(tool.inputSchema.safeParse(input).success, false);
  }
});

test('native load_skill schema is strict and a loaded guide cannot expand Agent permissions', async () => {
  const tool = new LoadSkillTool(registry());
  const execution = new ToolExecutionService({list:()=>[tool],get:()=>tool},new ToolPolicy());
  const [definition] = execution.toolDefinitions(['load_skill']);
  assert.deepEqual(definition.parameters.required, ['skillId']);
  assert.equal(definition.parameters.additionalProperties,false);
  const state = execution.createStateForAgent(['load_skill'],2);
  const context = {permissions:['load_skill'],state:new Map()};
  const result = await execution.execute('load_skill',{skillId:'product_consultation'},context,state);
  assert.equal(result.result.success,true);
  assert.deepEqual([...state.allowedTools],['load_skill']);
  const denied = await execution.execute('list_products',{},context,state);
  assert.equal(denied.result.errorCode,'tool_not_allowed');
  const repeated = await execution.execute('load_skill',{skillId:'product_consultation'},context,state);
  assert.equal(repeated.result.errorCode,'duplicate_tool_call');
});
