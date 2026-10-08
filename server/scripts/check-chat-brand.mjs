// Live UI smoke check. Does not send questions, call models, edit configuration or delete data.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

if (!process.env.PLAYWRIGHT_MODULE_PATH) throw new Error('PLAYWRIGHT_MODULE_PATH required');
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE_PATH);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 950 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const output = fileURLToPath(new URL('../../output/playwright/', import.meta.url));
  await mkdir(output, { recursive: true });
  await page.goto('http://localhost:8848/');
  await page.getByRole('button', { name: '新建对话', exact: true }).waitFor();
  await page.waitForFunction(() => !document.querySelector('.new-conversation').disabled);
  assert.equal(await page.title(), '禾序智能客服');
  assert.equal(await page.locator('.brand').textContent(), '禾序智能客服');
  assert.equal(await page.getByRole('link', { name: '产品官网', exact: true }).count(), 0);
  assert.equal(await page.getByRole('link', { name: '帮助中心', exact: true }).count(), 0);
  assert.ok(await page.locator('.brand img').evaluate(img => img.complete && img.naturalWidth > 0 && getComputedStyle(img).backgroundColor === 'rgba(0, 0, 0, 0)'));
  assert.equal(await page.locator('link[rel="icon"]').getAttribute('href'), '/favicon.svg');
  assert.equal((await context.request.get('http://localhost:8848/favicon.svg')).status(), 200);
  await page.getByLabel('输入问题', { exact: true }).fill('只检查草稿恢复，不发送问题');
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#question-input')?.value === '只检查草稿恢复，不发送问题');
  await page.screenshot({ path: output + 'hexu-chat-desktop.png' });
  for (const width of [375, 768, 1440]) {
    await page.setViewportSize({ width, height: width === 375 ? 812 : 950 });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    const height = await page.evaluate(() => ({ document: document.documentElement.scrollHeight, viewport: innerHeight, shell: document.querySelector('.app-shell').getBoundingClientRect().height }));
    assert.ok(height.document <= height.viewport, JSON.stringify({ width, ...height }));
    const composer = await page.locator('.composer').boundingBox();
    assert.ok(composer && composer.y >= 0 && composer.y + composer.height <= (width === 375 ? 812 : 950));
    if (width === 375) await page.screenshot({ path: output + 'hexu-chat-mobile.png' });
  }
  for (const path of ['/product', '/product/products', '/product/assistant', '/product/about', '/product/support', '/product/news', '/product/mijia-air-purifier-pro', '/help']) {
    await page.goto(`http://localhost:8848${path}`);
    await page.waitForURL('http://localhost:8848/');
    assert.equal(await page.title(), '禾序智能客服');
  }
  await page.goto('http://localhost:8848/admin');
  await page.locator('.admin-login-brand').waitFor();
  assert.ok((await page.locator('.admin-login-brand').textContent()).includes('禾序智能客服'));
  assert.equal(await page.title(), '禾序智能客服 · 管理中心');
  await page.goto('http://localhost:8848/docs/integration');
  await page.getByRole('heading', { name: 'Agent 接入文档', exact: true }).waitFor();
  assert.equal(await page.title(), '接入文档 · 禾序智能客服');
  assert.ok((await page.locator('.docs-brand').textContent()).includes('禾序智能客服'));
  assert.deepEqual(errors, []);
  console.log('Hexu brand/icon, old-site redirects, retained admin/docs, draft restore and desktop/mobile scrolling passed (no model calls).');
} finally { await browser.close(); }
