import assert from 'node:assert/strict';
import test from 'node:test';
import { readConfigEnvironment } from '../dist/config/config.schema.js';

test('configuration applies safe defaults without requiring an LLM key', () => {
  const config = readConfigEnvironment({});
  assert.equal(config.port, 3000);
  assert.deepEqual(config.llm, {
    provider: 'openai-compatible',
    apiKey: '',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    model: 'deepseek-v4-1-flash-260910',
    timeoutMs: 20000,
  });
});

test('configuration rejects invalid provider URL and timeout without exposing secrets', () => {
  assert.throws(() => readConfigEnvironment({ LLM_BASE_URL: 'not-a-url' }), /LLM_BASE_URL/);
  assert.throws(() => readConfigEnvironment({ LLM_TIMEOUT_MS: '999' }), /LLM_TIMEOUT_MS/);
  assert.throws(() => readConfigEnvironment({ LLM_PROVIDER: 'claude', LLM_API_KEY: 'secret-value' }), (error) => {
    assert.match(error.message, /LLM_PROVIDER/);
    assert.doesNotMatch(error.message, /secret-value/);
    return true;
  });
});
