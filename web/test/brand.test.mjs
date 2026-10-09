import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { pageTitle, siteBrand } from '../src/brand.ts';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');

test('admin and documentation use the same Hexu brand and route titles', () => {
  assert.equal(siteBrand.name, '禾序智能客服');
  assert.equal(pageTitle('/'), '禾序智能客服');
  assert.equal(pageTitle('/admin'), '禾序智能客服 · 管理中心');
  assert.equal(pageTitle('/admin/products'), '禾序智能客服 · 管理中心');
  assert.equal(pageTitle('/docs/integration'), '接入文档 · 禾序智能客服');
  for (const path of ['../src/AdminApp.vue', '../src/IntegrationDocs.vue']) {
    const content = read(path);
    assert.ok(content.includes('siteBrand.name'));
    assert.ok(content.includes('BrandMark'));
    assert.ok(!content.includes('暖巢'));
    assert.ok(!content.includes('产品智能客服'));
  }
});

test('favicon reuses the independent Hexu website icon and is included in production assets', () => {
  assert.equal(read('../public/favicon.svg'), read('../../website/public/favicon.svg'));
  const html = read('../index.html');
  assert.ok(html.includes('href="/favicon.svg"'));
  assert.ok(html.includes('<title>禾序智能客服</title>'));
  assert.ok(read('../Dockerfile').includes('COPY public ./public'));
});

test('public chat is removed while conversation management, admin and integration documentation stay', () => {
  const router = read('../src/router.ts');
  assert.ok(!router.includes("path: '/product"));
  assert.ok(!router.includes("path: '/help'"));
  assert.ok(router.includes("path: '/'"));
  assert.ok(router.includes("path: '/admin'"));
  assert.ok(router.includes("path: '/docs/integration'"));
  assert.ok(router.includes("path: '/:pathMatch(.*)*', redirect: '/admin'"));
  assert.ok(router.includes("path: '/', redirect: '/admin'"));
  assert.ok(router.includes("path: '/admin/conversations/:conversationId'"));
  for (const path of ['ChatWorkspace.vue', 'ProductHome.vue', 'ProductCatalog.vue', 'ProductSite.vue', 'ProductPublicLayout.vue', 'HelpCenter.vue', 'product-api.ts', 'product-data.ts']) {
    assert.ok(!existsSync(new URL(`../src/${path}`, import.meta.url)), `${path} should be removed`);
  }
  assert.ok(existsSync(new URL('../src/ProductCatalogAdmin.vue', import.meta.url)));
});

test('admin no longer imports or links to the removed public chat, including the old embed alias', () => {
  const app = read('../src/App.vue');
  assert.doesNotMatch(app, /ChatWorkspace|isLegacyEmbeddedChat|query\.embed/);
  assert.ok(app.includes('<AdminApp v-else'));
  assert.ok(!read('../src/AdminApp.vue').includes('href="/"'));
  const chat = read('../../website/src/chat/store.ts');
  assert.ok(chat.includes('grounded.activeConversationId'));
  assert.ok(chat.includes('grounded.pendingChatRequest'));
  assert.ok(chat.includes('grounded.draftInput.'));
});
