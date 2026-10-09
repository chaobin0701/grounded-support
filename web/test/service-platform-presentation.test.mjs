import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('existing model and vector platform display only logo and configuration name', async () => {
  for (const file of ['ModelServiceAdmin.vue', 'EmbeddingServiceAdmin.vue']) {
    const source = await readFile(new URL(`../src/${file}`, import.meta.url), 'utf8');
    assert.match(source, /v-if="editingId !== null" class="model-platform-identity"/);
    assert.match(source, /配置<\/strong>/);
    assert.ok(!source.includes('平台已固定'));
    assert.ok(!source.includes('新建替代配置'));
    assert.ok(!source.includes('配置已被引用'));
    assert.match(source, /v-else class="platform-options/);
  }
});
