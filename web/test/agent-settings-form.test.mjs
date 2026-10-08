import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { toggleCapability, validateAgentSettings } from '../src/agent-settings-form.ts';
const settings = () => { const { version, answerInstructions, ...value } = JSON.parse(readFileSync(new URL('../../server/config/agent.json', import.meta.url))); return value; };
test('default settings validate and memory cross-field errors identify the actionable field', () => {
  const value = settings(); assert.deepEqual(validateAgentSettings(value), {});
  value.memory.summaryKeepRecentTurns = value.memory.summaryTriggerTurns;
  value.memory.snapshotTurns = 1;
  value.runtime.maxPlannerRounds = value.runtime.maxToolCalls;
  const errors = validateAgentSettings(value);
  assert.ok(errors['memory.summaryKeepRecentTurns']); assert.ok(errors['memory.snapshotTurns']); assert.ok(errors['runtime.maxPlannerRounds']);
});
test('questions, persona and integer bounds validate before save', () => {
  const value = settings(); value.welcome.suggestedQuestions = []; value.identity.persona = ' '; value.runtime.toolTimeoutMs = 1.5;
  const errors = validateAgentSettings(value);
  assert.ok(errors['welcome.suggestedQuestions']); assert.ok(errors['identity.persona']); assert.ok(errors['runtime.toolTimeoutMs']);
});
test('capability toggle treats local and MCP aliases as one operation; system entries cannot be changed', () => {
  const value = settings(); const group = { system: false, tools: [{ name: 'list_products' }, { name: 'mcp_product_catalog_list_products' }] };
  toggleCapability(value, group, false);
  assert.equal(value.runtime.allowedTools.includes('list_products'), false); assert.equal(value.runtime.allowedTools.includes('mcp_product_catalog_list_products'), false);
  toggleCapability(value, group, true); assert.equal(value.runtime.allowedTools.filter(n => n === 'list_products').length, 1);
  toggleCapability(value, { system: true, tools: [{ name: 'load_skill' }] }, false); assert.ok(value.runtime.allowedTools.includes('load_skill'));
});
