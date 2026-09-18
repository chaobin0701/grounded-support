import assert from 'node:assert/strict';
import test from 'node:test';
import { ChatService, retrievalQuery, validateAnswer } from '../dist/chat/chat.service.js';
import { ChatRateLimitService } from '../dist/chat/chat-rate-limit.service.js';
import { LlmService } from '../dist/chat/llm.service.js';

const hit = {
  chunkId: 12, documentId: 3, documentTitle: '退货政策', originalFilename: 'returns.md',
  ordinal: 0, headingPath: '退货', content: '七天内可申请。', sourceStartLine: 2, sourceEndLine: 4, score: 0.8,
};

test('accepts an answer only with retrieved citations', () => {
  const result = validateAnswer(JSON.stringify({ status: 'answered', answer: '七天内可申请。', citationIds: [12] }), [hit]);
  assert.equal(result.refused, false);
  assert.deepEqual(result.citations, [{
    chunkId: 12, documentId: 3, documentTitle: '退货政策', originalFilename: 'returns.md',
    sourceStartLine: 2, sourceEndLine: 4,
  }]);
});

test('refuses invented, missing, or malformed citations', () => {
  for (const raw of [
    JSON.stringify({ status: 'answered', answer: '可以', citationIds: [999] }),
    JSON.stringify({ status: 'answered', answer: '可以', citationIds: [] }),
    'not JSON',
    JSON.stringify({ status: 'refused', answer: '可以', citationIds: [12] }),
  ]) {
    assert.deepEqual(validateAnswer(raw, [hit]), { answer: '无法确定，建议联系人工。', refused: true, citations: [] });
  }
});

test('limits anonymous requests per IP', async () => {
  const limiter = new ChatRateLimitService();
  for (let i = 0; i < 10; i += 1) assert.equal(await limiter.run('visitor', async () => 'ok'), 'ok');
  await assert.rejects(() => limiter.run('visitor', async () => 'no'), (error) => error.getStatus() === 429);
  assert.equal(await limiter.run('another', async () => 'ok'), 'ok');
});

test('follow-up question expands retrieval query but still answers from fresh sources', async () => {
  const searches = [];
  const prompts = [];
  const chat = new ChatService(
    { diagnose: async (query) => { searches.push(query); return { fusionResults: [hit] }; } },
    { completeDetailed: async (_system, user) => { prompts.push(JSON.parse(user)); return { content: JSON.stringify({ status: 'answered', answer: '七天内可申请。', citationIds: [12] }), model: 'fake', inputTokens: 10, outputTokens: 5, totalTokens: 15 }; } },
  );
  const history = [{ question: '退货政策是什么？', answer: '七天内可申请。' }];
  const result = await chat.ask('那它需要什么条件？', history);
  assert.equal(searches[0], '退货政策是什么？ 那它需要什么条件？');
  assert.deepEqual(prompts[0].history, history);
  assert.equal(prompts[0].sources[0].chunkId, 12);
  assert.equal(result.citations[0].chunkId, 12);
  assert.equal(retrievalQuery('保修多久？', history), '保修多久？');
});

test('answer model retries an empty response without logging secrets or prompt text', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.LLM_API_KEY;
  const warnings = [];
  let attempts = 0;
  process.env.LLM_API_KEY = 'test-secret-do-not-log';
  globalThis.fetch = async () => {
    attempts += 1;
    return new Response(JSON.stringify({ id: `test-${attempts}`, object: 'chat.completion', created: 1, model: 'deepseek-v4-1-flash-260910', choices: [{ index: 0, finish_reason: attempts === 1 ? 'length' : 'stop', message: { role: 'assistant', content: attempts === 1 ? '' : 'valid' } }], usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 } }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const llm = new LlmService();
    llm.logger.warn = (message) => warnings.push(message);
    const result = await llm.completeDetailed('private system', 'private user');
    assert.equal(result.content, 'valid');
    assert.deepEqual([result.inputTokens, result.outputTokens, result.totalTokens], [24, 8, 32]);
    assert.equal(attempts, 2);
    assert.match(warnings[0], /empty_response:length/);
    assert.ok(!warnings.join(' ').includes('test-secret-do-not-log'));
    assert.ok(!warnings.join(' ').includes('private'));
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.LLM_API_KEY; else process.env.LLM_API_KEY = originalKey;
  }
});

test('answer model fails closed after two empty responses', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.LLM_API_KEY;
  let attempts = 0;
  process.env.LLM_API_KEY = 'test-key';
  globalThis.fetch = async () => {
    attempts += 1;
    return new Response(JSON.stringify({ id: `test-${attempts}`, object: 'chat.completion', created: 1, model: 'deepseek-v4-1-flash-260910', choices: [{ index: 0, finish_reason: 'length', message: { role: 'assistant', content: '' } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const llm = new LlmService();
    llm.logger.warn = () => {};
    await assert.rejects(() => llm.complete('system', 'user'), (error) => error.getStatus() === 503);
    assert.equal(attempts, 2);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.LLM_API_KEY; else process.env.LLM_API_KEY = originalKey;
  }
});
