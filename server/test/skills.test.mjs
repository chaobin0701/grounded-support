import assert from 'node:assert/strict';
import test from 'node:test';
import { SkillRegistry, DuplicateSkillError, UnknownSkillError } from '../dist/ai/skills/skill-registry.js';
import { SkillSelector } from '../dist/ai/skills/skill-selector.js';

const customer = {
  id: 'customer_support', version: '1.0.0', name: 'Customer support', description: '',
  systemInstructions: '', allowedTools: ['search_knowledge'], maxToolCalls: 3, maxRuntimeMs: 30000, responseMode: 'grounded',
};
const product = {
  id: 'product_consultation', version: '1.0.0', name: 'Product consultation', description: '',
  systemInstructions: '', allowedTools: ['list_products'], maxToolCalls: 5, maxRuntimeMs: 30000, responseMode: 'product',
};

function registry() {
  const value = new SkillRegistry();
  value.register(customer);
  value.register(product);
  return value;
}

test('skill registry registers, lists and rejects duplicate or unknown skills', () => {
  const value = registry();
  assert.deepEqual(value.list().map((skill) => skill.id), ['customer_support', 'product_consultation']);
  assert.throws(() => value.register(customer), DuplicateSkillError);
  assert.throws(() => value.get('missing'), UnknownSkillError);
});

test('skill selector uses deterministic product intent and customer default', () => {
  const selector = new SkillSelector(registry());
  assert.equal(selector.select('这个产品的价格是多少？').skill.id, 'product_consultation');
  assert.equal(selector.select('如何申请退货？').skill.id, 'customer_support');
  assert.equal(selector.select('anything', 'product_consultation').selectedBy, 'explicit');
  assert.throws(() => selector.select('anything', 'not_registered'), /Unknown skill/);
});
