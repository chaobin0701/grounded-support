import assert from 'node:assert/strict';
import test from 'node:test';
import { SecurityRateLimitService } from '../dist/security/security-rate-limit.service.js';
import { normalizeError } from '../dist/security/error-response.js';
import { redact } from '../dist/security/redaction.js';

test('security limiter enforces configured limits across calls and returns a stable error body', async () => {
  // Exercise a small explicit threshold rather than tying this test to deployment defaults.
  const limiter = new SecurityRateLimitService({ security: { chatWindowLimit: 10, documentUploadLimit: 10 } });
  for (let i = 0; i < 10; i += 1) await limiter.run('chat', 'visitor', async () => 'ok');
  await assert.rejects(() => limiter.run('chat', 'visitor', async () => 'no'), (error) => {
    assert.equal(error.getStatus(), 429);
    assert.deepEqual(error.getResponse(), { code: 'rate_limit_exceeded', message: '请求过于频繁，请稍后重试。' });
    return true;
  });
  for (let i = 0; i < 10; i += 1) await limiter.run('document-upload', 'admin-ip', async () => 'ok');
  await assert.rejects(() => limiter.run('document-upload', 'admin-ip', async () => 'no'), (error) => error.getStatus() === 429);
});

test('error normalization hides unexpected server details', () => {
  const result = normalizeError(new Error('database password=secret'), 'req-1');
  assert.equal(result.status, 500);
  assert.deepEqual(result.body, { error: { code: 'internal_error', message: '服务暂时不可用，请稍后重试。' }, requestId: 'req-1' });
});

test('redaction removes credential and prompt fields', () => {
  assert.deepEqual(redact({ authorization: 'Bearer secret', password: 'pw', prompt: 'private', status: 'ok' }), {
    authorization: '[REDACTED]', password: '[REDACTED]', prompt: '[REDACTED]', status: 'ok',
  });
});
