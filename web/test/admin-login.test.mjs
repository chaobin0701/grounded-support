import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('login prefills only the public demo credentials and permits non-email identities', async () => {
  const source = await readFile(new URL('../src/AdminApp.vue', import.meta.url), 'utf8');
  assert.match(source, /const email = ref\('demo-user'\)/);
  assert.match(source, /const password = ref\('demo123456'\)/);
  assert.match(source, /邮箱或账号<input v-model.trim="email" type="text"/);
  assert.match(source, /v-model.trim="newAdmin.email"[^>]*type="text"/);
  assert.match(source, /v-model="newAdmin.password"[^>]*minlength="10"/);
  assert.ok(!source.includes('登录状态保存在当前浏览器'));
  assert.ok(!source.includes('仅授权管理员可访问资料与权限操作'));
  assert.ok(!source.includes('返回访客问答'));
});

test('admin creation uses the dedicated username field rather than a fake email address', async () => {
  const source = await readFile(new URL('../src/admin-api.ts', import.meta.url), 'utf8');
  assert.match(source, /identifier.includes\('@'\) \? \{ email: identifier \} : \{ username: identifier \}/);
});
