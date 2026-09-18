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
