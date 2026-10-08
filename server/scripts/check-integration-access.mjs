// End-to-end check against the live development server. All credentials stay in memory.
// Creates one uniquely named fixture application and removes only its own resources in finally.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { JwtService } from '@nestjs/jwt';

if (!process.env.PLAYWRIGHT_MODULE_PATH) throw new Error('PLAYWRIGHT_MODULE_PATH required');
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE_PATH);
const pool = new pg.Pool({host:'127.0.0.1',port:Number(process.env.POSTGRES_PORT||5433),user:process.env.POSTGRES_USER,password:process.env.POSTGRES_PASSWORD,database:process.env.POSTGRES_DB||'grounded_support'});
const signer = new JwtService({secret:process.env.JWT_SECRET,signOptions:{issuer:process.env.JWT_ISSUER||'grounded-support',audience:process.env.JWT_AUDIENCE||'grounded-support-admin',expiresIn:600}});
const base='http://localhost:8848', fixtureName=`接入验证-${randomUUID().slice(0,8)}`;
let browser, fixtureId;
try {
  const actor=(await pool.query("SELECT a.id FROM admins a JOIN admin_roles ar ON ar.admin_id=a.id JOIN roles r ON r.id=ar.role_id WHERE r.code='super_admin' AND a.disabled_at IS NULL ORDER BY a.id LIMIT 1")).rows[0];
  assert.ok(actor);
  const token=await signer.signAsync({sub:String(actor.id)});
  const me=await fetch(base+'/api/admin/auth/me',{headers:{Authorization:`Bearer ${token}`}}).then(r=>r.json());
  assert.ok(me.permissionCodes.includes('integrations.manage'));
  browser=await chromium.launch({channel:'chrome',headless:true});
  const context=await browser.newContext({viewport:{width:1440,height:950},permissions:['clipboard-read','clipboard-write']});
  await context.addInitScript(session=>localStorage.setItem('grounded-support.admin-session.v1',JSON.stringify(session)),{token,me,expiresAt:Date.now()+600000});
  const page=await context.newPage(); const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/admin/integrations');
  await page.getByRole('button',{name:'添加应用',exact:true}).waitFor();
  console.log('Initial access management snapshot:\n'+await page.locator('.integration-admin').ariaSnapshot());
  const output=fileURLToPath(new URL('../../output/playwright/',import.meta.url)); await mkdir(output,{recursive:true});
  await page.screenshot({path:output+'integrations-desktop.png',fullPage:true});
  await page.getByRole('button',{name:'添加应用',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'添加接入应用',exact:true});
  await dialog.getByLabel('应用名称',{exact:true}).fill(fixtureName);
  await dialog.getByLabel('授权域名',{exact:true}).fill(base);
  await dialog.getByLabel('平台 API',{exact:true}).check();
  await dialog.getByLabel('平台汇总用量（仅服务端）',{exact:true}).check();
  await dialog.getByLabel('限制每日 Token 用量',{exact:true}).check();
  await dialog.getByLabel('每日 Token 上限',{exact:true}).fill('100000');
  await dialog.getByRole('button',{name:'保存配置',exact:true}).click();
  await page.locator('.toast-notice').filter({hasText:'接入配置已保存'}).waitFor();
  fixtureId=(await pool.query('SELECT id FROM integration_apps WHERE name=$1',[fixtureName])).rows[0].id;
  const savedDialog=page.getByRole('dialog',{name:fixtureName,exact:true});
  await savedDialog.getByRole('button',{name:'平台密钥',exact:true}).click();
  await savedDialog.getByRole('button',{name:'创建密钥',exact:true}).click();
  const keyDialog=page.getByRole('dialog',{name:'创建平台密钥',exact:true});
  await keyDialog.getByLabel('密钥名称',{exact:true}).fill('一次性验证密钥');
  await keyDialog.getByRole('button',{name:'创建密钥',exact:true}).click();
  const secretDialog=page.getByRole('dialog',{name:'请保存接入密钥',exact:true});
  await secretDialog.waitFor();
  const key=await secretDialog.locator('code').textContent();assert.ok(key.startsWith('ag_live_'));
  await secretDialog.getByRole('button',{name:'复制密钥',exact:true}).click();
  assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),key);
  await secretDialog.getByRole('button',{name:'已保存，关闭',exact:true}).click();
  assert.equal(await page.getByText(key,{exact:true}).count(),0);
  assert.ok(!(await page.evaluate(()=>JSON.stringify({...localStorage,...sessionStorage}))).includes(key));
  assert.equal(await savedDialog.getByRole('button',{name:'接入示例',exact:true}).count(),0);
  await savedDialog.getByRole('button',{name:'复制应用 ID',exact:true}).click();
  assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),fixtureId);
  // One real model request verifies the runtime boundary and existing native SSE; not a fake streaming check.
  const response=await fetch(base+'/api/v1/agent/messages',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json','Idempotency-Key':'live-native-sse'},body:JSON.stringify({userId:'fixture-user',message:'你好，简单打个招呼即可。',stream:true})});
  assert.equal(response.status,200);
  const sse=await response.text();assert.match(sse,/event: done/);assert.match(sse,/event: answer_delta/);
  const done=sse.match(/event: done\ndata: (.+)/)?.[1];assert.ok(done);const result=JSON.parse(done);
  assert.ok(result.traceId&&result.runId);assert.equal(result.toolSteps,undefined);
  assert.ok(result.usage.totalTokens>0);assert.equal(result.usage.accounting,'actual');
  const usage=await fetch(base+'/api/v1/agent/usage',{headers:{Authorization:`Bearer ${key}`}}).then(r=>r.json());
  assert.equal(usage.scope,'application');assert.equal(usage.tokenLimit,100000);assert.equal(usage.totalTokens,result.usage.totalTokens);assert.equal(usage.reservedTokens,0);
  console.log(JSON.stringify({nativeSse:true,deltas:(sse.match(/event: answer_delta/g)||[]).length,hasTraceId:true,hasRunId:true,usage:result.usage}));
  const replay=await fetch(base+'/api/v1/agent/messages',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json','Idempotency-Key':'live-native-sse'},body:JSON.stringify({userId:'fixture-user',message:'你好，简单打个招呼即可。',stream:false})}).then(r=>r.json());
  assert.equal(replay.traceId,result.traceId);
  assert.deepEqual(replay.usage,result.usage);
  await savedDialog.getByRole('button',{name:'调用统计',exact:true}).click();
  await savedDialog.getByRole('button',{name:'刷新统计',exact:true}).click();
  await savedDialog.getByRole('cell',{name:'完成',exact:true}).waitFor();
  await savedDialog.getByText('每日 Token 额度',{exact:true}).waitFor();
  await page.screenshot({path:output+'integration-usage.png',fullPage:true});
  const appConfig=await fetch(base+'/api/admin/integrations/'+fixtureId,{headers:{Authorization:`Bearer ${token}`}}).then(r=>r.json());
  const {name,enabled,websiteEnabled,apiEnabled,allowedOrigins,scopes,requestsPerMinute,concurrency,dailyRequests}=appConfig.app;
  const setQuota=limit=>fetch(base+'/api/admin/integrations/'+fixtureId,{method:'PATCH',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({name,enabled,websiteEnabled,apiEnabled,allowedOrigins,scopes,requestsPerMinute,concurrency,dailyRequests,dailyTokenLimit:limit})});
  assert.equal((await setQuota(1)).status,200);
  const blocked=await fetch(base+'/api/v1/agent/messages',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({userId:'fixture-user',message:'你好',stream:true})});
  assert.equal(blocked.status,429);const quotaError=await blocked.json();assert.equal(quotaError.error.code,'daily_token_quota_exceeded');assert.ok(quotaError.error.retryAt);assert.ok(blocked.headers.get('retry-after'));
  const status=await fetch(base+'/api/v1/agent/status',{headers:{Authorization:`Bearer ${key}`}}).then(r=>r.json());assert.equal(status.canSend,false);assert.ok(status.retryAt);
  assert.equal((await setQuota(100000)).status,200);
  await savedDialog.getByRole('button',{name:'平台密钥',exact:true}).click();
  await savedDialog.getByRole('button',{name:'轮换',exact:true}).click();
  await page.getByRole('dialog',{name:'轮换平台密钥',exact:true}).getByRole('button',{name:'确认轮换',exact:true}).click();
  await secretDialog.waitFor(); await secretDialog.getByRole('button',{name:'已保存，关闭',exact:true}).click();
  assert.equal((await fetch(base+'/api/v1/agent/conversations?userId=fixture-user',{headers:{Authorization:`Bearer ${key}`}})).status,401);
  await savedDialog.getByRole('button',{name:'撤销',exact:true}).click();
  await page.getByRole('dialog',{name:'撤销平台密钥',exact:true}).getByRole('button',{name:'确认撤销',exact:true}).click();
  await page.locator('.toast-notice').filter({hasText:'密钥已撤销'}).waitFor();
  await savedDialog.getByRole('button',{name:'关闭',exact:true}).first().click();
  await page.goto(base+'/admin/conversations?app='+fixtureId);
  await page.locator('.session-item').first().waitFor();assert.equal(await page.locator('.session-item').count(),1);
  assert.equal(await page.getByLabel('接入应用筛选').inputValue(),fixtureId);
  for(const viewport of [{width:375,height:812},{width:1024,height:720}]) {
    await page.setViewportSize(viewport);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  }
  await page.goto(base+'/admin/integrations');
  await page.getByRole('button',{name:new RegExp(fixtureName)}).click();
  for(const viewport of [{width:1440,height:950},{width:375,height:812}]) {
    await page.setViewportSize(viewport);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.screenshot({path:output+`integration-editor-${viewport.width}.png`,fullPage:true});
  }
  assert.deepEqual(errors,[]);
  console.log('Integration UI, daily-token settings, actual SSE usage, quota rejection, scoped status/usage, idempotency, key lifecycle and responsive checks passed');
} finally {
  await browser?.close();
  if(!fixtureId) fixtureId=(await pool.query('SELECT id FROM integration_apps WHERE name=$1',[fixtureName])).rows[0]?.id;
  if(fixtureId) {
    const client=await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM integration_calls WHERE app_id=$1',[fixtureId]);
      await client.query('DELETE FROM conversations WHERE application_id=$1',[fixtureId]);
      await client.query('DELETE FROM visitor_sessions WHERE application_id=$1',[fixtureId]);
      await client.query('DELETE FROM integration_api_keys WHERE app_id=$1',[fixtureId]);
      await client.query('DELETE FROM integration_apps WHERE id=$1 AND name=$2 AND NOT is_internal',[fixtureId,fixtureName]);
      await client.query("DELETE FROM audit_logs WHERE target_type='integration' AND target_id=$1",[fixtureId]);
      await client.query('COMMIT');
    } catch(e) {await client.query('ROLLBACK');throw e;} finally {client.release();}
  }
  await pool.end();
}
