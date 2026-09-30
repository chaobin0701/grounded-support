import assert from 'node:assert/strict';
import test from 'node:test';
import { readConfigEnvironment } from '../dist/config/config.schema.js';

test('configuration applies safe defaults without requiring an LLM key', () => {
  const config = readConfigEnvironment({});
  assert.equal(config.port, 3000);
  assert.equal(config.uploadRoot, '/data/uploads');
  assert.equal(config.jwt.issuer, 'grounded-support');
  assert.equal(config.jwt.audience, 'grounded-support-admin');
  assert.equal(config.security.chatWindowLimit, 10);
  assert.equal(config.security.documentUploadConcurrency, 2);
  assert.equal(config.embedding.model, 'doubao-embedding-vision-251215');
  assert.deepEqual(config.llm, {
    provider: 'openai-compatible',
    apiKey: '',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    model: 'deepseek-v4-1-flash-260910',
    timeoutMs: 20000,
    contextWindowTokens: 32000,
    maxOutputTokens: 1200,
  });
});

test('configuration parses explicit security boundaries', () => {
  const config = readConfigEnvironment({
    DATABASE_URL: 'postgres://example',
    JWT_SECRET: 'a'.repeat(32),
    TRUST_PROXY: '2',
    ALLOWED_ORIGINS: 'http://localhost:8081, https://admin.example.com',
    CHAT_RATE_LIMIT: '20',
    ADMIN_LOGIN_RATE_LIMIT: '3',
    DOCUMENT_UPLOAD_CONCURRENCY: '1',
    EMBEDDING_MODEL: 'test-embedding',
  });
  assert.equal(config.databaseUrl, 'postgres://example');
  assert.equal(config.security.trustProxy, 2);
  assert.deepEqual(config.security.allowedOrigins, ['http://localhost:8081', 'https://admin.example.com']);
  assert.equal(config.security.chatWindowLimit, 20);
  assert.equal(config.security.adminLoginLimit, 3);
  assert.equal(config.security.documentUploadConcurrency, 1);
  assert.equal(config.embedding.model, 'test-embedding');
  assert.equal(config.llm.contextWindowTokens, 32000);
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
