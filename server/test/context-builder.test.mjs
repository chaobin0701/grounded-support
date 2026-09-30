import assert from 'node:assert/strict';
import test from 'node:test';
import { ContextBuilder } from '../dist/chat/context-builder.js';

test('context builder keeps summary, recent history and tool results in one bounded prompt', () => {
  const builder = new ContextBuilder();
  const context = builder.build({
    question: '  那它怎么清洁？  ',
    summary: '用户正在了解 H2。',
    recentHistory: [
      { question: '第一轮', answer: '回答一' },
      { question: '第二轮', answer: '回答二' },
      { question: '第三轮', answer: '回答三' },
      { question: '第四轮', answer: '回答四' },
    ],
    toolResults: [{ tool: 'search_knowledge', result: '资料片段' }],
    transcript: [{
      conversationId: 'conversation-1', traceId: 'trace-1', sequence: 1,
      createdAt: '2026-09-29T00:00:00.000Z', role: 'assistant',
      toolCalls: [{ id: 'tool-1', name: 'search_knowledge', arguments: { query: 'H2' } }],
    }],
  });
  const payload = JSON.parse(context.userPrompt);
  assert.equal(payload.question, '那它怎么清洁？');
  assert.equal(payload.summary, '用户正在了解 H2。');
  assert.equal(payload.history.length, 3);
  assert.equal(payload.history[0].question, '第二轮');
  assert.equal(payload.toolResults.length, 1);
  assert.equal(context.metadata.summaryIncluded, true);
  assert.equal(context.metadata.historyCount, 3);
  assert.equal(context.metadata.toolResultCount, 1);
  assert.equal(payload.agentTranscript.length, 1);
  assert.equal(payload.agentTranscript[0].toolCalls[0].name, 'search_knowledge');
  assert.equal(context.metadata.transcriptCount, 1);
  assert.equal(context.metadata.transcriptVersion, 1);
  assert.equal(context.metadata.truncated, true);
});
