import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { renderIntegrationDocument } from '../src/integration-document.ts';

const source = readFileSync(new URL('../src/docs/integration.md', import.meta.url), 'utf8');
const api = readFileSync(new URL('../../server/src/chat/agent-api.controller.ts', import.meta.url), 'utf8');

test('the standalone document has a complete, unique, linkable contents list', () => {
  const { html, sections } = renderIntegrationDocument(source);
  assert.equal(sections.length, 11);
  assert.equal(new Set(sections.map(item => item.id)).size, sections.length);
  for (const section of sections) assert.ok(html.includes(`id="${section.id}"`));
  assert.ok(sections.some(item => item.title === 'SSE 流式回答'));
  assert.ok(sections.some(item => item.title === '幂等与重试'));
  assert.ok(sections.some(item => item.title === '权限与安全边界'));
});

test('document rendering escapes HTML, blocks unsafe links/images and contains table overflow', () => {
  const { html } = renderIntegrationDocument('<script>alert(1)</script>\n\n[bad](javascript:alert(1))\n\n[docs](https://example.com)\n\n[anchor](#section-1)\n\n![alt](https://example.com/track.png)\n\n| key | value |\n| --- | --- |\n| a | b |');
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('href="javascript:'));
  assert.ok(!html.includes('<img'));
  assert.match(html, /target="_blank" rel="noopener noreferrer"/);
  assert.match(html, /<a href="#section-1">anchor<\/a>/);
  assert.ok(html.includes('class="doc-table-scroll"'));
});

test('document lists the implemented external API routes and current authorization scopes', () => {
  for (const [method, path] of [['Post', 'messages'], ['Get', 'status'], ['Get', 'usage'], ['Get', 'conversations'], ['Get', 'conversations/:id/messages'], ['Get', 'conversations/:id/runs'], ['Delete', 'conversations/:id']]) {
    assert.ok(api.includes(`@${method}('${path}')`));
    assert.ok(source.includes(`/api/v1/agent/${path}`));
  }
  for (const scope of ['chat:write', 'conversations:read', 'conversations:delete', 'usage:read']) assert.ok(source.includes(scope));
  assert.ok(source.includes('不代表服务端取消执行'));
  assert.ok(source.includes('tokenLimit / remainingTokens 为 null'));
});

test('access management links to standalone docs without maintaining an embedded example tab', () => {
  const admin = readFileSync(new URL('../src/IntegrationAdmin.vue', import.meta.url), 'utf8');
  const router = readFileSync(new URL('../src/router.ts', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../src/App.vue', import.meta.url), 'utf8');
  assert.ok(!admin.includes('接入示例'));
  assert.ok(!admin.includes('browserExample'));
  assert.ok(admin.includes('to="/docs/integration"'));
  assert.ok(admin.includes('aria-label="复制应用 ID"'));
  assert.ok(router.includes("path: '/docs/integration'"));
  assert.ok(app.includes('<IntegrationDocs v-if="isIntegrationDocs"'));
});

// Exercise the actual downloadable snippet, not a second copy of its parser.
const readerCode = source.match(/```js\n(async function readAgentEvents[\s\S]+?)\n```/)?.[1];
assert.ok(readerCode);
const readAgentEvents = new Function(`${readerCode}\nreturn readAgentEvents;`)();
function streamResponse(text, bytewise = false) {
  const bytes = new TextEncoder().encode(text);
  return new Response(new ReadableStream({ start(controller) {
    if (bytewise) for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
    else controller.enqueue(bytes);
    controller.close();
  } }), { headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } });
}

test('document SSE reader preserves Chinese UTF-8 split at every byte and handles CRLF/multiline data', async () => {
  const received = [];
  await readAgentEvents(streamResponse(': heartbeat\r\n\r\nevent: answer_delta\r\ndata: {"text":"暖巢"}\r\n\r\nevent: done\r\ndata: {\r\ndata: "answer":"暖巢"}\r\n\r\n', true), (event, data) => received.push([event, data]));
  assert.deepEqual(received, [['answer_delta', { text: '暖巢' }], ['done', { answer: '暖巢' }]]);
});

test('document SSE reader accepts done-only replay, flushes tail and does not invent deltas', async () => {
  const received = [];
  await readAgentEvents(streamResponse('event: done\ndata: {"answer":"已完成"}'), (event, data) => received.push([event, data]));
  assert.deepEqual(received, [['done', { answer: '已完成' }]]);
});

test('document SSE reader marks missing done and streamed errors as unfinished', async () => {
  await assert.rejects(readAgentEvents(streamResponse('event: answer_delta\ndata: {"text":"部分"}\n\n'), () => {}), /尚未收到 done/);
  const events = [];
  await assert.rejects(readAgentEvents(streamResponse('event: error\ndata: {"status":429,"code":"daily_token_quota_exceeded","message":"额度不足"}\n\n'), (event, data) => events.push([event, data])), error => error.status === 429 && error.code === 'daily_token_quota_exceeded');
  assert.equal(events[0][0], 'error');
  await assert.rejects(readAgentEvents(new Response('{}', { status: 403 }), () => {}));
  await assert.rejects(readAgentEvents(new Response('{}'), () => {}), /未返回 SSE/);
});
