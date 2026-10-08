import assert from 'node:assert/strict';
import test from 'node:test';
import 'reflect-metadata';
import { LlmProfileService } from '../dist/ai/providers/llm-profile.service.js';
import { LlmProfileController } from '../dist/ai/providers/llm-profile.controller.js';
import { ProviderAuthenticationError, ProviderTimeoutError } from '../dist/ai/providers/provider-errors.js';
import { PERMISSION_KEY } from '../dist/admin/permission.decorator.js';

const baseUrl = 'https://ark.cn-beijing.volces.com/api/v3';
const row = (id, extra = {}) => ({ id, name: `profile ${id}`, platform_key: 'volcengine', base_url: baseUrl, model: 'test-model', api_key_ciphertext: 'ciphertext', timeout_ms: 20000, context_window_tokens: 32000, max_output_tokens: 1200, enabled: true, is_default: false, supports_tool_calls: true, supports_streaming: true, ...extra });
const input = { name: 'unsaved configuration', platformKey: 'volcengine', baseUrl, model: 'unsaved-model', timeoutMs: 45000, contextWindowTokens: 64000, maxOutputTokens: 2048 };

function fixture(rows, options = {}) {
  const calls = []; const activated = []; const sent = [];
  let state = structuredClone(rows);
  const query = async (sql, values = []) => {
    calls.push({ sql, values });
    if (sql.includes('SELECT id::int')) return { rows: sql.includes('WHERE id = $1') ? state.filter(item => item.id === values[0]) : state };
    if (sql.startsWith('DELETE FROM llm_profiles')) { state = state.filter(item => item.id !== values[0]); return { rows: [] }; }
    if (sql.startsWith('UPDATE llm_profiles SET is_default')) {
      state.forEach(item => { if (sql.includes('WHERE is_default') ? item.is_default : item.id === values[0]) item.is_default = sql.includes('= TRUE'); });
      return { rows: state.filter(item => item.id === values[0]) };
    }
    if (sql.startsWith('UPDATE llm_profiles SET enabled')) { const item = state.find(item => item.id === values[0]); item.enabled = values[1]; return { rows: [item] }; }
    if (sql.startsWith('UPDATE llm_profiles SET')) { const item = state.find(item => item.id === values[0]); if (sql.includes('name = $2')) item.name = values[1]; return { rows: item ? [item] : [] }; }
    return { rows: [] };
  };
  const database = { query, transaction: async action => { const backup = structuredClone(state); try { return await action({ query }); } catch (error) { state = backup; throw error; } } };
  const config = { llm: { allowedBaseUrls: [baseUrl], apiKey: options.environmentKey } };
  const secrets = { encrypt: value => `encrypted:${value}`, decrypt: () => options.savedKey ?? '12-secret-api-key-89' };
  const registry = { activateProfile: value => activated.push(value), createFromProfile: profile => { sent.push(profile); return { chat: async request => { sent.push(request); if (options.providerError) throw options.providerError; return { content: options.content ?? '连接成功', model: profile.model, durationMs: 45 }; } }; } };
  return { service: new LlmProfileService(database, config, secrets, registry), calls, activated, sent, state: () => state };
}

test('profile views include only masked key preview, never secrets or ciphertext', async () => {
  const f = fixture([row(1)]); const [view] = await f.service.list();
  assert.equal(view.apiKeyPreview, '12***89'); assert.equal(view.hasApiKey, true);
  assert.ok(!JSON.stringify(view).includes('secret-api-key')); assert.ok(!JSON.stringify(view).includes('ciphertext'));
  assert.ok(!('apiKey' in view));
});
test('short keys are fully masked; environment keys and missing keys have safe previews', async () => {
  assert.equal((await fixture([row(1)], { savedKey: 'abc' }).service.list())[0].apiKeyPreview, '********');
  assert.equal((await fixture([row(1, { api_key_ciphertext: null })], { environmentKey: 'ab-env-key-yz' }).service.list())[0].apiKeyPreview, 'ab***yz');
  assert.equal((await fixture([row(1, { api_key_ciphertext: null })]).service.list())[0].apiKeyPreview, null);
});
test('connection test uses unsaved form values without creating or activating a profile', async () => {
  const f = fixture([]); const result = await f.service.testConnection({ ...input, apiKey: 'new-api-key' });
  assert.equal(result.ok, true); assert.equal(result.model, 'unsaved-model'); assert.equal(result.responsePreview, '连接成功');
  assert.equal(f.sent[0].apiKey, 'new-api-key'); assert.equal(f.sent[0].timeoutMs, 45000);
  assert.equal(f.sent[1].maxTokens, 64); assert.equal(f.calls.length, 0); assert.equal(f.activated.length, 0);
});
test('editing with blank key reuses saved credentials but sends the edited model', async () => {
  const f = fixture([row(1)]); await f.service.testConnection({ ...input, profileId: 1 });
  assert.equal(f.sent[0].apiKey, '12-secret-api-key-89'); assert.equal(f.sent[0].model, 'unsaved-model');
  assert.ok(f.calls.every(call => call.sql.startsWith('SELECT')));
});
test('test rejects unapproved URL and unknown profile before contacting provider', async () => {
  const f = fixture([]);
  await assert.rejects(f.service.testConnection({ ...input, baseUrl: 'https://internal.example', apiKey: 'key' }), error => error.getStatus() === 400);
  await assert.rejects(f.service.testConnection({ ...input, profileId: 99 }), error => error.getStatus() === 404);
  assert.equal(f.sent.length, 0);
});
test('empty outputs and provider errors become actionable safe test failures', async () => {
  await assert.rejects(fixture([], { content: '  ' }).service.testConnection({ ...input, apiKey: 'key' }), /返回为空/);
  await assert.rejects(fixture([], { providerError: new ProviderAuthenticationError() }).service.testConnection({ ...input, apiKey: 'key' }), /密钥无效/);
  await assert.rejects(fixture([], { providerError: new ProviderTimeoutError() }).service.testConnection({ ...input, apiKey: 'key' }), /连接超时/);
});
test('deleting an unused profile writes audit in the transaction', async () => {
  const f = fixture([row(1), row(2, { is_default: true })]);
  assert.deepEqual(await f.service.remove(7, 1), { deleted: true, activeProfileId: null });
  assert.deepEqual(f.state().map(item => item.id), [2]); assert.equal(f.activated.length, 0);
  const audit = f.calls.find(call => call.sql.includes('llm_profile.deleted')); assert.ok(audit); assert.equal(audit.values[0], 7);
  assert.ok(!JSON.stringify(audit).includes('secret-api-key'));
});
test('current profile deletion requires a distinct enabled replacement; invalid choices do not delete', async () => {
  const f = fixture([row(1, { is_default: true }), row(2, { enabled: false })]);
  for (const payload of [{}, { replacementId: 1 }, { replacementId: 99 }, { replacementId: 2 }]) await assert.rejects(f.service.remove(7, 1, payload));
  assert.equal(f.state().length, 2); assert.equal(f.state()[0].is_default, true);
  assert.ok(!f.calls.some(call => call.sql.startsWith('DELETE')));
});
test('current profile switches to enabled replacement and deletes atomically', async () => {
  const f = fixture([row(1, { is_default: true }), row(2)]);
  assert.deepEqual(await f.service.remove(7, 1, { replacementId: 2 }), { deleted: true, activeProfileId: 2 });
  assert.equal(f.state().length, 1); assert.equal(f.state()[0].is_default, true); assert.equal(f.activated[0].id, 2);
  assert.ok(f.calls[0].sql.includes('LOCK TABLE'));
});
test('unknown/invalid deletions are rejected and active configuration cannot be disabled', async () => {
  const f = fixture([row(1, { is_default: true })]);
  await assert.rejects(f.service.remove(7, 99), error => error.getStatus() === 404);
  await assert.rejects(f.service.remove(7, 1, { replacementId: '2' }), error => error.getStatus() === 400);
  await assert.rejects(f.service.setEnabled(7, 1, false), /请先切换/);
});
test('updating current profile refreshes runtime, using database is_default field', async () => {
  const f = fixture([row(1, { is_default: true })]);
  await f.service.update(7, 1, { name: 'updated' });
  assert.equal(f.activated[0].name, 'updated');
});
test('test and delete endpoints retain model management permission', () => {
  for (const method of ['testConnection', 'test', 'remove', 'update']) assert.deepEqual(Reflect.getMetadata(PERMISSION_KEY, LlmProfileController.prototype[method]), ['model_profiles.manage']);
});
