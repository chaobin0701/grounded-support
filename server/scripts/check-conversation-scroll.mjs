// Read-only browser regression check. Admin credentials remain in memory and
// the temporary browser context is closed without changing the user's session.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { JwtService } from '@nestjs/jwt';

const require = createRequire(import.meta.url);
if (!process.env.PLAYWRIGHT_MODULE_PATH) throw new Error('Set PLAYWRIGHT_MODULE_PATH to the installed Playwright package');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH);
const pool = new pg.Pool({ host: '127.0.0.1', port: Number(process.env.POSTGRES_PORT || 5433), user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD, database: process.env.POSTGRES_DB || 'grounded_support' });
const signer = new JwtService({ secret: process.env.JWT_SECRET, signOptions: { issuer: process.env.JWT_ISSUER || 'grounded-support',
  audience: process.env.JWT_AUDIENCE || 'grounded-support-admin', expiresIn: 300 } });
const base = 'http://localhost:8848';
let browser;
try {
  const actor = (await pool.query(`SELECT a.id FROM admins a JOIN admin_roles ar ON ar.admin_id=a.id
    JOIN roles r ON r.id=ar.role_id WHERE r.code='super_admin' AND a.disabled_at IS NULL ORDER BY a.id LIMIT 1`)).rows[0];
  assert.ok(actor, 'Existing super administrator required');
  const token = await signer.signAsync({ sub: String(actor.id) });
  const response = await fetch(`${base}/api/admin/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(response.status, 200);
  const me = await response.json();
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript(session => localStorage.setItem('grounded-support.admin-session.v1', JSON.stringify(session)),
    { token, expiresAt: Date.now() + 300000, me });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${base}/admin/conversations`);
  await page.locator('.session-item').first().waitFor();
  console.log('Table header snapshot:\n' + await page.locator('.session-table thead').ariaSnapshot());
  const output = fileURLToPath(new URL('../../output/playwright/', import.meta.url));
  await mkdir(output, { recursive: true });

  for (const viewport of [{ width:1440,height:1000 }, { width:1024,height:720 }]) {
    await page.setViewportSize(viewport);
    const scroller = page.getByRole('region', { name:'会话记录',exact:true });
    await scroller.evaluate(el => { el.scrollTop = 0; });
    const header = page.getByRole('columnheader', { name:'会话',exact:true });
    const before = await header.boundingBox();
    const rowBefore = await page.locator('.session-item').first().boundingBox();
    const filterBefore = await page.getByLabel('时间筛选').boundingBox();
    const pagerBefore = await page.locator('.session-pagination').boundingBox();
    assert.ok(await scroller.evaluate(el => el.scrollHeight > el.clientHeight), 'Existing conversations must overflow for this regression check');
    await scroller.hover();
    await page.mouse.wheel(0, 750);
    await page.waitForFunction(() => document.querySelector('.session-list').scrollTop > 400);
    const after = await header.boundingBox();
    const rowAfter = await page.locator('.session-item').first().boundingBox();
    assert.ok(Math.abs(after.y - before.y) < 1, 'Header must remain fixed while records move');
    assert.ok(rowAfter.y < rowBefore.y - 400, 'Only records should scroll');
    assert.equal((await page.getByLabel('时间筛选').boundingBox()).y, filterBefore.y);
    assert.equal((await page.locator('.session-pagination').boundingBox()).y, pagerBefore.y);
    assert.ok(await header.evaluate(el => { const box = el.getBoundingClientRect(); return document.elementFromPoint(box.x+20,box.y+box.height/2)?.closest('th') === el; }), 'Sticky header must cover row links beneath it');
    await page.screenshot({ path:output + `conversation-sticky-${viewport.width}.png`,fullPage:true });
    await scroller.focus(); await page.keyboard.press('Home');
    await page.waitForFunction(() => document.querySelector('.session-list').scrollTop === 0);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    console.log(JSON.stringify({ viewport, headerStayedFixed:true, recordsScrolled:true, filtersAndPaginationFixed:true }));
  }

  for (const viewport of [{ width:375,height:812 }, { width:812,height:375 }]) {
    await page.setViewportSize(viewport);
    const scroller = page.getByRole('region', { name:'会话记录',exact:true });
    await scroller.evaluate(el => { el.scrollTop=400; });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Responsive view must not overflow horizontally');
    if (viewport.height < 540) await page.locator('.admin-main').evaluate(el => { el.scrollTop = el.scrollHeight; });
    const footer = await page.locator('.session-pagination').boundingBox();
    await page.screenshot({ path:output+`conversation-responsive-${viewport.width}.png`,fullPage:true });
    assert.ok(await scroller.evaluate(el => el.clientHeight >= 100), 'Short viewport must not shrink the records out of view');
    console.log(JSON.stringify({ responsiveViewport:viewport,paginationVisible:true }));
    assert.ok(footer && footer.y >= 0 && footer.y + footer.height <= viewport.height + 1, 'Pagination remains in viewport');
    if (viewport.width === 375) assert.equal(await page.getByRole('columnheader').count(), 0, 'Mobile keeps its existing card layout');
  }
  assert.deepEqual(errors, []);
  console.log('Conversation scroll regression passed');
} finally { await browser?.close(); await pool.end(); }
