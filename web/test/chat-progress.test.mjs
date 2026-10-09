import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
test('后台移除独立聊天入口，保留会话管理与轨迹耗时诊断', async () => {
  const source = await readFile(new URL('../src/App.vue', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /ChatWorkspace/);
  const admin = await readFile(new URL('../src/ConversationTraceAdmin.vue', import.meta.url), 'utf8');
  assert.match(admin, /durationMs/);
});
test('官网保留历史和流式正文之前的执行过程，后台无重复访客工作区', async () => {
  const source = await readFile(new URL('../../website/src/components/ChatWorkspace.vue', import.meta.url), 'utf8');
  const history = source.slice(source.indexOf('v-for="message in state.messages"'), source.indexOf('v-if="state.isSending ||'));
  const pending = source.slice(source.indexOf('v-if="state.isSending ||'));
  assert.ok(history.indexOf('<ChatProgress') < history.indexOf('<ChatMarkdown'));
  assert.ok(pending.indexOf('<ChatProgress') < pending.indexOf('<ChatMarkdown'));
  assert.doesNotMatch(source, /process-step-meta|process-step-copy|process-panel pending-process/);
  const css = await readFile(new URL('../src/design.css', import.meta.url), 'utf8');
  assert.match(css, /\.process-collapsible \.process-content\s*\{[^}]*border:0/);
  const processCss = css.slice(css.indexOf('.message-process'), css.indexOf('.spinning {'));
  assert.doesNotMatch(processCss, /process-step:not\(:last-child\)::before|process-step-meta|border-top:1px/);
});
