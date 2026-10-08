import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
test('独立聊天页展示具体操作说明，不渲染耗时或结果数量；后台调试仍显示耗时', async () => {
  const source = await readFile(new URL('../src/ChatWorkspace.vue', import.meta.url), 'utf8');
  assert.match(source, /const activeStatus = computed/);
  assert.match(source, /\{\{ activeStatus \}\}/);
  assert.doesNotMatch(source, /formatDuration|event\.durationMs|event\.resultCount/);
  const admin = await readFile(new URL('../src/ConversationTraceAdmin.vue', import.meta.url), 'utf8');
  assert.match(admin, /durationMs/);
});
test('执行过程在历史和流式正文之前，紧凑组件不再显示重复分类和状态列', async () => {
  const source = await readFile(new URL('../src/ChatWorkspace.vue', import.meta.url), 'utf8');
  const history = source.slice(source.indexOf('<template v-else><BrandMark'), source.indexOf('<div v-if="isSending"'));
  const pending = source.slice(source.indexOf('<div v-if="isSending"'));
  assert.ok(history.indexOf('<ChatProgress') < history.indexOf('class="answer-text"'));
  assert.ok(pending.indexOf('<ChatProgress') < pending.indexOf('class="answer-text"'));
  assert.doesNotMatch(source, /process-step-meta|process-step-copy|process-panel pending-process/);
  const css = await readFile(new URL('../src/design.css', import.meta.url), 'utf8');
  assert.match(css, /\.process-collapsible \.process-content\s*\{[^}]*border:0/);
  const processCss = css.slice(css.indexOf('.message-process'), css.indexOf('.spinning {'));
  assert.doesNotMatch(processCss, /process-step:not\(:last-child\)::before|process-step-meta|border-top:1px/);
});
