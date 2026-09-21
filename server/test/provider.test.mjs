import assert from 'node:assert/strict';
import test from 'node:test';
import { OpenAICompatibleProvider } from '../dist/ai/providers/openai-compatible.provider.js';
import { ProviderAuthenticationError, ProviderRateLimitError, ProviderTimeoutError } from '../dist/ai/providers/provider-errors.js';

test('OpenAI-compatible provider normalizes text, tool calls, usage and duration', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    assert.equal(body.model, 'test-model');
    assert.equal(body.messages[0].role, 'system');
    assert.equal(body.tools[0].function.name, 'list_products');
    return new Response(JSON.stringify({
      choices: [{ finish_reason: 'tool_calls', message: {
        content: '我先查一下产品。',
        tool_calls: [{ id: 'call-1', function: { name: 'list_products', arguments: '{"search":"暖风机"}' } }],
      } }],
      usage: { prompt_tokens: 10, completion_tokens: 6, total_tokens: 16 },
    }), { status: 200 });
  };
  try {
    const provider = new OpenAICompatibleProvider({ apiKey: 'test-key', baseUrl: 'https://test.example.invalid/api/v3', model: 'test-model', timeoutMs: 1000, supportedModels: ['test-model'] });
    const result = await provider.chat({
      model: 'test-model',
      messages: [{ role: 'system', content: 'system' }, { role: 'user', content: 'question' }],
      tools: [{ name: 'list_products', description: 'list', parameters: { type: 'object' } }],
    });
    assert.equal(result.content, '我先查一下产品。');
    assert.deepEqual(result.toolCalls, [{ id: 'call-1', name: 'list_products', arguments: { search: '暖风机' } }]);
    assert.deepEqual(result.usage, { inputTokens: 10, outputTokens: 6, totalTokens: 16 });
    assert.equal(result.finishReason, 'tool_calls');
    assert.equal(typeof result.durationMs, 'number');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('provider maps authentication, rate limit and timeout failures', async () => {
  const originalFetch = globalThis.fetch;
  try {
    const noKey = new OpenAICompatibleProvider({ apiKey: '', baseUrl: 'https://test.example.invalid/api/v3', model: 'test-model', timeoutMs: 1000, supportedModels: ['test-model'] });
    await assert.rejects(() => noKey.chat({ model: 'test-model', messages: [] }), ProviderAuthenticationError);

    globalThis.fetch = async () => new Response('{}', { status: 429 });
    const rateLimited = new OpenAICompatibleProvider({ apiKey: 'test-key', baseUrl: 'https://test.example.invalid/api/v3', model: 'test-model', timeoutMs: 1000, supportedModels: ['test-model'] });
    await assert.rejects(() => rateLimited.chat({ model: 'test-model', messages: [] }), ProviderRateLimitError);

    globalThis.fetch = async () => { throw new DOMException('timeout', 'TimeoutError'); };
    const timedOut = new OpenAICompatibleProvider({ apiKey: 'test-key', baseUrl: 'https://test.example.invalid/api/v3', model: 'test-model', timeoutMs: 1000, supportedModels: ['test-model'] });
    await assert.rejects(() => timedOut.chat({ model: 'test-model', messages: [] }), ProviderTimeoutError);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
