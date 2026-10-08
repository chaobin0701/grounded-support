import assert from 'node:assert/strict';
import test from 'node:test';
import {
  conversationDetailLocation,
  conversationListPath,
  conversationListQuery,
  readConversationListState,
} from '../src/conversation-navigation.ts';

const conversationId = '8b52198b-984d-4714-8d60-569c0f5425f0';
const traceId = 'a054d3f9-64bc-4d78-bf5a-d5cfc9163ba1';
const visitorId = '46d8c66e-62c9-4ae4-8cb4-624796f2e7a9';

test('list route is independent and an unfiltered detail has a shareable child URL', () => {
  assert.equal(conversationListPath, '/admin/conversations');
  assert.deepEqual(conversationDetailLocation(conversationId), {
    path: `/admin/conversations/${conversationId}`, query: {},
  });
});

test('filters and pagination survive list to detail to list, without retaining focus IDs', () => {
  const state = { query: 'H2 暖风机', visitorId, device: 'browser', timeRange: '7d', offset: 30 };
  const target = conversationDetailLocation(conversationId, traceId, state);
  assert.equal(target.query.traceId, traceId);
  assert.deepEqual(readConversationListState(target.query), state);
  assert.deepEqual(conversationListQuery(readConversationListState(target.query)), {
    q: 'H2 暖风机', visitor: visitorId, device: 'browser', range: '7d', page: '2',
  });
});

test('unfiltered list query stays clean', () => {
  const state = readConversationListState({});
  assert.deepEqual(state, { query: '', visitorId: '', device: 'all', timeRange: 'all', offset: 0 });
  assert.deepEqual(conversationListQuery(state), {});
});

test('array query values, unknown selectors, bad UUIDs and invalid page offsets use safe defaults', () => {
  for (const page of ['0', '-3', 'NaN', 'Infinity', '1.5', '9007199254740991', ['2', '3']]) {
    const state = readConversationListState({ q: ['hidden', 'duplicate'], visitor: '/external', device: 'unknown', range: 'unknown', page });
    assert.deepEqual(state, { query: '', visitorId: '', device: 'all', timeRange: 'all', offset: 0 });
  }
});

test('a trace focus never replaces the conversation path or survives a malformed ID', () => {
  assert.deepEqual(conversationDetailLocation(conversationId, '../../other'), {
    path: `/admin/conversations/${conversationId}`, query: {},
  });
  assert.throws(() => conversationDetailLocation('../audit'), /UUID/);
  assert.throws(() => conversationDetailLocation('8b52198b'), /UUID/);
});

test('application isolation filter survives detail navigation and discards malformed query values', () => {
  const state = { query: '', visitorId: '', device: 'api', timeRange: 'all', offset: 0, applicationId: visitorId };
  const detail = conversationDetailLocation(conversationId, traceId, state);
  assert.deepEqual(readConversationListState(detail.query), state);
  assert.equal(conversationListQuery(state).app, visitorId);
  assert.equal(readConversationListState({ app: '../other' }).applicationId, undefined);
});
