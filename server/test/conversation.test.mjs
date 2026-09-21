import assert from 'node:assert/strict';
import test from 'node:test';
import { ConversationService } from '../dist/chat/conversation.service.js';

test('anonymous browser cookie resumes one identity without storing its plaintext token', async () => {
  const sessions = new Map();
  const database = {
    query: async (sql, values) => {
      if (sql.startsWith('SELECT id FROM visitor_sessions')) return { rows: sessions.has(values[0]) ? [{ id: sessions.get(values[0]) }] : [] };
      if (sql.startsWith('INSERT INTO visitor_sessions')) {
        sessions.set(values[1], values[0]);
        return { rows: [] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  const service = new ConversationService(database, {}, {});
  const issued = [];
  const response = { cookie: (_name, value, options) => issued.push({ value, options }) };
  const first = await service.session({ headers: {}, secure: false }, response);
  const resumed = await service.session({ headers: { cookie: `grounded_visitor=${issued[0].value}` }, secure: false }, response);
  const second = await service.session({ headers: {}, secure: false }, response);
  assert.equal(first, resumed);
  assert.notEqual(first, second);
  assert.equal(issued.length, 2);
  assert.equal(issued[0].options.httpOnly, true);
  assert.equal(issued[0].options.sameSite, 'lax');
  assert.ok(!sessions.has(issued[0].value));
});

test('conversation lookup does not reveal another browser identity', async () => {
  const service = new ConversationService({ query: async () => ({ rows: [] }) }, {}, {});
  await assert.rejects(() => service.get('different-browser', 'conversation-id'), (error) => error.getStatus() === 404);
});

test('conversation snapshot keeps summary and recent history inside one conversation boundary', async () => {
  const database = {
    query: async (sql, values) => {
      if (sql.startsWith('SELECT id, title, summary')) {
        if (values[1] !== 'browser-a') return { rows: [] };
        return { rows: [{ id: values[0], title: '暖风机', summary: '用户正在比较 H1 和 H2。', summaryThroughMessageId: 2, createdAt: 'now', updatedAt: 'now' }] };
      }
      if (sql.startsWith('SELECT id::int, role, content')) {
        return { rows: [
          { id: 4, role: 'assistant', content: 'H2 的额定功率是 1500 W。', refused: false },
          { id: 3, role: 'user', content: 'H2 有多大功率？', refused: null },
        ] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  const service = new ConversationService(database, {}, {});
  const snapshot = await service.snapshot('browser-a', 'conversation-a');
  assert.equal(snapshot.conversationId, 'conversation-a');
  assert.equal(snapshot.summary, '用户正在比较 H1 和 H2。');
  assert.deepEqual(snapshot.history, [{ question: 'H2 有多大功率？', answer: 'H2 的额定功率是 1500 W。' }]);
  await assert.rejects(() => service.snapshot('browser-b', 'conversation-a'), (error) => error.getStatus() === 404);
});

test('an expired run cannot persist a late answer', async () => {
  const statements = [];
  const client = {
    query: async (sql) => {
      statements.push(sql);
      if (sql.includes('FROM conversation_runs') && sql.includes("status = 'running'")) return { rows: [] };
      throw new Error(`Unexpected query after expired run guard: ${sql}`);
    },
  };
  const database = { transaction: async (callback) => callback(client) };
  const service = new ConversationService(database, {}, { model: 'test-model' });
  await assert.rejects(
    () => service.saveResult?.('conversation-a', '晚到的问题', {
      result: { answer: '不应保存', refused: false, citations: [] },
      contextSnapshot: {}, rawModelOutput: null,
      inputTokens: null, outputTokens: null, totalTokens: null,
    }, 10, 'run-a'),
    (error) => error.getStatus() === 409,
  );
  assert.equal(statements.length, 1);
});
