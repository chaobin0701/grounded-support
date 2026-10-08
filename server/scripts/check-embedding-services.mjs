// Opt-in local API/browser smoke check. Credentials remain in memory; screenshots
// contain only the existing masked key preview, never plaintext tokens or keys.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { JwtService } from '@nestjs/jwt';
const pool=new pg.Pool({host:'127.0.0.1',port:Number(process.env.POSTGRES_PORT||5433),user:process.env.POSTGRES_USER,password:process.env.POSTGRES_PASSWORD,database:process.env.POSTGRES_DB||'grounded_support'});
const base=process.env.CHECK_BASE_URL||'http://localhost:8848';
const signer=new JwtService({secret:process.env.JWT_SECRET,signOptions:{issuer:process.env.JWT_ISSUER||'grounded-support',audience:process.env.JWT_AUDIENCE||'grounded-support-admin',expiresIn:600}});
let browser,temporaryId,token;
async function api(path,method='GET',body,credential=token) {
  const response=await fetch(`${base}/api/admin${path}`,{method,headers:{...(credential?{Authorization:`Bearer ${credential}`}:{'Accept':'application/json'}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  return {status:response.status,body:await response.json()};
}
try {
  const actor=(await pool.query(`SELECT a.id FROM admins a JOIN admin_roles ar ON ar.admin_id=a.id JOIN roles r ON r.id=ar.role_id
    WHERE r.code='super_admin' AND a.disabled_at IS NULL ORDER BY a.id LIMIT 1`)).rows[0];
  assert.ok(actor,'an existing super administrator is required');
  token=await signer.signAsync({sub:String(actor.id)});
  assert.equal((await api('/model-profiles/embedding','GET',undefined,null)).status,401);
  const limited=(await pool.query(`SELECT a.id FROM admins a WHERE a.disabled_at IS NULL AND NOT EXISTS(
    SELECT 1 FROM admin_roles ar JOIN role_permissions rp ON rp.role_id=ar.role_id
    WHERE ar.admin_id=a.id AND rp.permission_code IN ('embedding_profiles.read','embedding_profiles.manage')) LIMIT 1`)).rows[0];
  if(limited) assert.equal((await api('/model-profiles/embedding','GET',undefined,await signer.signAsync({sub:String(limited.id)}))).status,403);
  const listed=await api('/model-profiles/embedding');assert.equal(listed.status,200);
  assert.ok(listed.body.every(p=>!p.api_key_ciphertext && !p.apiKey && !p.config.apiKey));
  const meta=await api('/model-profiles/embedding/metadata');assert.equal(meta.status,200);
  const preset=meta.body.platforms.find(p=>p.key==='volcengine');
  const created=await api('/model-profiles/embedding','POST',{name:'临时界面验证配置',platformKey:preset.key,provider:preset.provider,baseUrl:preset.baseUrl,model:preset.model,dimensions:preset.dimensions,maxInputChars:8000,batchSize:16,timeoutMs:30000,apiKey:'fixture-not-used-credential'});
  assert.equal(created.status,201);temporaryId=created.body.id;
  assert.equal((await api(`/model-profiles/embedding/${temporaryId}`,'PATCH',{name:'临时配置已更新'})).status,200);
  assert.equal((await api(`/model-profiles/embedding/${temporaryId}`,'PATCH',{platformKey:'openai'})).status,400);
  assert.equal((await api(`/model-profiles/embedding/${temporaryId}/status`,'PATCH',{enabled:false})).status,200);
  assert.equal((await api(`/model-profiles/embedding/${temporaryId}`,'DELETE')).status,200);temporaryId=null;
  console.log(JSON.stringify({api:'passed',unauthenticated:401,withoutPermission:limited?403:'no existing limited account',profiles:listed.body.length,temporaryCrud:'passed'}));
  if(!process.env.PLAYWRIGHT_MODULE_PATH) process.exitCode=0;
  else {
    const require=createRequire(import.meta.url);
    const {chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH);
    browser=await chromium.launch({channel:'chrome',headless:true});
    const context=await browser.newContext({viewport:{width:1440,height:1000}});
    const me=(await api('/auth/me')).body;
    await context.addInitScript(session=>localStorage.setItem('grounded-support.admin-session.v1',JSON.stringify(session)),{token,expiresAt:Date.now()+600000,me});
    const page=await context.newPage(); const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    const output=fileURLToPath(new URL('../../output/playwright/',import.meta.url));await mkdir(output,{recursive:true});
    await page.goto(`${base}/admin/embedding-services`);
    await page.getByRole('button',{name:/查看配置/}).first().waitFor();
    console.log('Embedding page snapshot:\n'+await page.locator('.embedding-services-page').ariaSnapshot());
    await page.screenshot({path:output+'embedding-services-desktop.png',fullPage:true});
    await page.getByRole('button',{name:/查看配置/}).first().click();
    await page.getByRole('dialog').waitFor();
    console.log('Configuration dialog snapshot:\n'+await page.getByRole('dialog').ariaSnapshot());
    await page.screenshot({path:output+'embedding-services-edit.png',fullPage:true});
    if(process.env.CHECK_REAL_CONNECTION==='1') {
      const responsePromise=page.waitForResponse(r=>r.url().endsWith('/model-profiles/embedding/test') && r.request().method()==='POST',{timeout:125000});
      await page.getByRole('button',{name:'测试连接',exact:true}).click();
      const response=await responsePromise; const result=await response.json();assert.equal(response.status(),201);
      console.log('realConnectionTest='+JSON.stringify(result));
      await page.getByRole('heading',{name:result.ok?'连接成功':'连接未通过',exact:true}).waitFor();
      await page.screenshot({path:output+'embedding-services-test.png',fullPage:true});
      await page.getByRole('dialog').last().getByRole('button',{name:'关闭',exact:true}).click();
    }
    await page.getByRole('dialog').getByRole('button',{name:'关闭',exact:true}).click();
    await page.getByRole('button',{name:'添加配置',exact:true}).click();
    await page.getByRole('dialog').waitFor();
    await page.getByRole('button',{name:/OpenAI OpenAI Compatible 接口/}).click();
    assert.equal(await page.getByLabel(/^Base URL/).inputValue(),'https://api.openai.com/v1');
    await page.setViewportSize({width:390,height:844});
    await page.waitForTimeout(200); // Let the 150ms feedback transition settle for visual capture.
    await page.screenshot({path:output+'embedding-services-mobile.png',fullPage:true});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false,'no mobile horizontal overflow');
    await page.getByRole('dialog').getByRole('button',{name:'关闭',exact:true}).click();
    const knowledge=(await api('/knowledge-bases')).body.find(k=>!k.archivedAt);
    if(knowledge) {
      await page.setViewportSize({width:1440,height:1000}); await page.goto(`${base}/admin/knowledge/${knowledge.id}/settings`);
      await page.getByRole('heading',{name:'索引版本',exact:true}).waitFor();
      assert.equal(await page.getByRole('dialog').count(),0);
      await page.screenshot({path:output+'embedding-knowledge-settings.png',fullPage:true});
    }
    assert.deepEqual(errors,[]);console.log(JSON.stringify({browser:'passed',responsive:'passed',screenshots:output}));
  }
} finally {
  if(temporaryId) await api(`/model-profiles/embedding/${temporaryId}`,'DELETE');
  await browser?.close();await pool.end();
}
