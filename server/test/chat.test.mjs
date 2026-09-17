import assert from 'node:assert/strict';
import test from 'node:test';
import { validateAnswer } from '../dist/chat/chat.service.js';
import { ChatRateLimitService } from '../dist/chat/chat-rate-limit.service.js';

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
