import assert from 'node:assert/strict';
import test from 'node:test';
import { conversationTurns, turnStatus, groupTraceSteps, formatDuration } from '../src/conversation-view.ts';
import { renderSafeMarkdown } from '../src/markdown.ts';
const message = (id, role, content = role) => ({ id, role, content, refused: false });
test('missing first answer cannot consume the answer from a later turn', () => {
  const turns = conversationTurns({ messages: [message(1, 'user'), message(2, 'user'), message(3, 'assistant')], runs: [], traces: [] });
  assert.equal(turns[0].assistant, null); assert.equal(turns[1].assistant.id, 3);
});
test('exact run message references are authoritative even for repeated questions', () => {
  const turns = conversationTurns({ messages: [message(1, 'user', 'same'), message(2, 'user', 'same'), message(3, 'assistant', 'second'), message(4, 'assistant', 'first')], runs: [{ userMessageId: 1, assistantMessageId: 4, status: 'completed' }, { userMessageId: 2, assistantMessageId: 3, status: 'completed' }], traces: [] });
  assert.equal(turns[0].assistant.content, 'first'); assert.equal(turns[1].assistant.content, 'second');
});
test('successful answer without a trace is not a failure; refusal is separate', () => {
  assert.equal(turnStatus({ assistant: message(1, 'assistant'), trace: null, run: null }).tone, 'answered');
  assert.equal(turnStatus({ assistant: null, trace: null, run: null }).tone, 'neutral');
  assert.equal(turnStatus({ assistant: { content: '无法确定', refused: true }, trace: { status: 'completed' }, run: { status: 'completed' } }).tone, 'refused');
  assert.equal(turnStatus({ assistant: { content: 'partial' }, trace: null, run: { status: 'interrupted' } }).tone, 'neutral');
});
test('multiple tools are grouped beneath their planner call, not artificial new rounds', () => {
  const step = (type, extra = {}) => ({ type, durationMs: 10, ok: true, ...extra });
  const groups = groupTraceSteps([step('skill_selection'), step('llm_call', { plannerRound: 1 }), step('tool_call'), step('tool_call'), step('llm_call', { plannerRound: 2 }), step('tool_call'), step('llm_call', { stage: 'final_answer' }), step('validation')]);
  assert.equal(groups[1].label, '第 1 次模型规划'); assert.equal(groups[1].steps.length, 3); assert.equal(groups[1].durationMs, 30);
  assert.equal(groups[2].label, '第 2 次模型规划'); assert.equal(groups[3].label, '最终回答生成'); assert.equal(groups[4].label, '回复格式校验');
});
test('Markdown renders emphasis/lists while blocking raw HTML, script links, and remote images', () => {
  const html = renderSafeMarkdown('**额定功率**\n\n- 1500 W\n\n<script>alert(1)</script>\n\n[x](javascript:alert(1))\n\n![alt](https://tracker.example/img)\n\n[官方](https://example.com)');
  assert.ok(html.includes('<strong>额定功率</strong>')); assert.ok(html.includes('<ul>'));
  assert.ok(!html.includes('<script>')); assert.ok(!html.includes('href="javascript:')); assert.ok(!html.includes('<img'));
  assert.ok(html.includes('noopener noreferrer')); assert.ok(html.includes('target="_blank"'));
});
test('duration formatting handles absent and subsecond values', () => {
  assert.equal(formatDuration(null), '—'); assert.equal(formatDuration(24), '24 ms'); assert.equal(formatDuration(2300), '2.3 s');
});
