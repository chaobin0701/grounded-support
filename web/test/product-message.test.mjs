import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { productMessageParts } from '../src/product-message.ts';

const context = { productIds: ['xiaomi-electric-warmer'], productReferences: [{ productId: 'xiaomi-electric-warmer', offset: 8, length: 5 }], products: [{ id: 'xiaomi-electric-warmer', name: '已改名的目录产品' }] };
test('admin and standalone chat style existing names without duplicating text or losing newlines', () => {
  const content = '这个产品怎么样\n米家电暖器';
  const parts = productMessageParts(content, context);
  assert.deepEqual(parts, [{ type: 'text', text: '这个产品怎么样\n' }, { type: 'product', id: 'xiaomi-electric-warmer', name: '米家电暖器' }]);
  assert.equal(parts.map(p => p.type === 'text' ? p.text : p.name).join(''), content);
});
test('old offset-only messages display the formerly missing product in its original position', () => {
  const parts = productMessageParts('这个产品怎么样', { ...context, productReferences: [{ productId: 'xiaomi-electric-warmer', offset: 7 }], products: [{ id: 'xiaomi-electric-warmer', name: '米家电暖器' }] });
  assert.equal(parts.map(p => p.type === 'text' ? p.text : p.name).join(''), '这个产品怎么样米家电暖器');
});
test('invalid ranges keep readable body text and unlinked messages remain unchanged', () => {
  const content = '<img src=x onerror=alert(1)>问题';
  for (const reference of [{ offset: 99, length: 5 }, { offset: -1, length: 5 }, { offset: 0, length: 0 }]) {
    assert.deepEqual(productMessageParts(content, { ...context, productReferences: [{ productId: 'xiaomi-electric-warmer', ...reference }] }), [{ type: 'text', text: content }]);
  }
  assert.deepEqual(productMessageParts(content), [{ type: 'text', text: content }]);
});
test('both administration and legacy workspace use safe shared product-message rendering', () => {
  const read = path => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');
  for (const file of ['ConversationTraceAdmin.vue', 'ChatWorkspace.vue']) assert.ok(read(file).includes('<ProductMessageContent'));
  const component = read('ui/ProductMessageContent.vue');
  assert.ok(component.includes('{{ part.name }}'));
  assert.ok(!component.includes('v-html'));
  for (const declaration of ['font: inherit', 'line-height: inherit', 'vertical-align: middle', 'width: 1em', 'height: 1em']) assert.ok(component.includes(declaration));
  assert.ok(component.includes('class="product-message-text-segment"'));
  assert.ok(!component.includes('font-size: 13px'));
});
