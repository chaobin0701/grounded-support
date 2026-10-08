import test from 'node:test';
import assert from 'node:assert/strict';
import { progressSteps, progressStatus, toolLabel } from '../src/chat/progress.ts';

const start = (operationId, text, tool = 'list_products') => ({ type: 'progress', id: `${operationId}-start`, operationId, stage: 'tool', status: 'running', text, tool });
const done = event => ({ ...event, id: `${event.operationId}-done`, status: 'completed', text: event.text.replace('正在', '已'), durationMs: 1234, resultCount: 8 });

test('首轮等待不猜测工具，工具开始后按当前操作实时说明，已完成步骤不冒充执行中', () => {
  assert.equal(progressStatus([]), '正在理解你的问题…');
  const catalog = start('catalog', '正在查看产品目录');
  const detail = start('detail', '正在读取产品详细规格', 'get_product_detail');
  assert.equal(progressStatus([catalog]), '正在查看产品目录…');
  assert.equal(progressStatus([catalog, done(catalog)]), '正在继续处理你的问题…');
  assert.equal(progressStatus([catalog, done(catalog), detail]), '正在读取产品详细规格…');
  const events = [catalog, done(catalog), detail, done(detail)];
  assert.equal(progressSteps(events).length, 2);
  assert.equal(progressStatus(events), '正在继续处理你的问题…');
  assert.equal(progressStatus(events, true), '正在生成回答…');
  assert.equal(progressSteps(events)[0].durationMs, 1234); // Preserve metadata, hide only in the UI.
});
test('隐藏 planning/preflight/answer，不把内部解释或回答生成作为工具步骤；等待状态仍正常接续', () => {
  const internal = { ...start('internal', 'PRIVATE_REASONING'), stage: 'planning' };
  assert.equal(progressStatus([internal, { ...internal, stage: 'preflight' }]), '正在理解你的问题…');
  assert.equal(progressStatus([{ ...internal, stage: 'answer', text: '资料已准备完成，正在整理回答…' }]), '资料已准备完成，正在整理回答…');
  assert.deepEqual(progressSteps([{ ...internal, stage: 'answer', text: '回答生成完成' }]), []);
});
test('工具名称采用中性描述，不改原始事件、状态或错误文字', () => {
  for (const text of ['已查看产品分类', '正在查看产品分类', '查看产品分类']) assert.equal(toolLabel(text), '查看产品分类');
  assert.equal(toolLabel('已读取产品详细规格…'), '读取产品详细规格');
  assert.equal(toolLabel('正在检索知识库资料...'), '检索知识库资料');
  assert.equal(toolLabel('未能读取产品详情'), '未能读取产品详情');
});
