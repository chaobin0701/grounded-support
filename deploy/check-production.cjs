// Uses a short-lived in-memory admin token; prints only validation metadata.
// A disposable chat is removed afterwards; actual model usage is not refunded.
const {Pool}=require('pg');
const {JwtService}=require('@nestjs/jwt');
const {randomUUID}=require('node:crypto');
const assert=require('node:assert/strict');
const pool=new Pool({connectionString:process.env.DATABASE_URL});
const base='http://api:3000',origin=`https://${process.env.WEBSITE_DOMAIN}`;
let cookie='',conversationId,phase='admin';
async function request(path,body,method=body?'POST':'GET',token) {
  const response=await fetch(base+path,{method,headers:{Origin:origin,
    ...(cookie?{Cookie:cookie}:{}),...(token?{Authorization:`Bearer ${token}`}:{ }),
    ...(body?{'Content-Type':'application/json','Idempotency-Key':randomUUID()}:{})},
    ...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(90000)});
  const issued=response.headers.getSetCookie().find(v=>v.startsWith('grounded_visitor='));
  if(issued)cookie=issued.split(';')[0];
  return response;
}
async function json(path,body,method,token) {
  const response=await request(path,body,method,token);
  if(!response.ok) {let code='http_error';try{code=(await response.json()).code||code;}catch{}throw Error(`${path}: ${response.status} ${code}`);}
  return response.json();
}
(async()=>{
  const admin=(await pool.query(`SELECT a.id::int FROM admins a JOIN admin_roles ar ON ar.admin_id=a.id
    JOIN roles r ON r.id=ar.role_id WHERE a.disabled_at IS NULL AND r.code='super_admin' ORDER BY a.id LIMIT 1`)).rows[0];
  assert.ok(admin);
  const token=await new JwtService().signAsync({sub:String(admin.id)},{secret:process.env.JWT_SECRET,
    issuer:process.env.JWT_ISSUER||'grounded-support',audience:process.env.JWT_AUDIENCE||'grounded-support-admin',expiresIn:300});
  for(const path of ['/api/health','/api/admin/auth/me','/api/admin/dashboard','/api/admin/agent-config','/api/admin/knowledge-bases']) {
    await json(path,undefined,'GET',token);console.log(JSON.stringify({endpoint:path,ok:true}));
  }
  const unauthorized=await fetch(base+'/api/admin/auth/me');assert.equal(unauthorized.status,401);
  const denied=await fetch(base+'/api/chat/conversations',{headers:{Origin:'https://unauthorized.example'}});assert.equal(denied.status,403);
  const products=await json('/api/products');assert.ok(products.length);
  phase='model';
  const profile=(await json('/api/admin/model-profiles/llm',undefined,'GET',token)).find(p=>p.isDefault);
  assert.ok(profile);
  if(!process.env.SKIP_PROVIDER_PROBES) {
    const modelTest=await json(`/api/admin/model-profiles/llm/${profile.id}/test`,{},'POST',token);
    console.log(JSON.stringify({modelTest:{ok:modelTest.ok,capabilities:modelTest.capabilities,model:modelTest.model}}));
  }
  const embeddings=await json('/api/admin/model-profiles/embedding',undefined,'GET',token);
  for(const p of embeddings.filter(p=>p.enabled&&!process.env.SKIP_PROVIDER_PROBES)) {
    const fields=p.config;
    const tested=await json('/api/admin/model-profiles/embedding/test',{profileId:p.id,name:p.name,platformKey:p.platformKey,
      provider:fields.provider,baseUrl:fields.baseUrl,model:fields.model,dimensions:fields.dimensions,
      maxInputChars:fields.maxInputChars,batchSize:fields.batchSize,timeoutMs:fields.timeoutMs},'POST',token);
    assert.equal(tested.ok,true);console.log(JSON.stringify({embeddingTest:{ok:true,dimensions:tested.actualDimensions}}));
  }
  conversationId=(await json('/api/chat/conversations',undefined,'POST')).id;
  assert.ok(conversationId);
  phase='stream';
  const product=products.find(p=>p.id==='xiaomi-electric-warmer')||products[0];
  const first=await request(`/api/chat/conversations/${conversationId}/messages/stream`,{
    question:`请简要介绍${product.name}的参数与适用场景。`,context:{productIds:[product.id]}});
  assert.equal(first.status,200);assert.match(first.headers.get('content-type'),/text\/event-stream/);
  const text=await first.text();
  const events=text.split(/\r?\n\r?\n/).flatMap(frame=>{
    const data=frame.split(/\r?\n/).filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trim()).join('\n');
    const event=frame.split(/\r?\n/).find(l=>l.startsWith('event:'))?.slice(6).trim();
    try{return data?[{event,data:JSON.parse(data)}]:[];}catch{return [];}
  });
  const done=events.find(e=>e.event==='done')?.data;assert.ok(done);assert.equal(done.refused,false);
  console.log(JSON.stringify({streamTest:{answered:!done.refused,events:events.length}}));
  phase='followup';
  const followup=await json(`/api/chat/conversations/${conversationId}/messages`,{question:'刚才这个产品的额定功率是多少？'});
  assert.equal(followup.refused,false);
  const snapshot=(await pool.query("SELECT context_snapshot FROM chat_traces WHERE conversation_id=$1 AND kind='answer' ORDER BY created_at DESC LIMIT 1",[conversationId])).rows[0].context_snapshot;
  assert.ok(snapshot.contextMemory.restored>0);
  const planner=snapshot.modelCalls.find(c=>c.purpose==='planner');
  const prompt=JSON.parse(planner.request.messages.at(-1).content);
  assert.ok(prompt.productContext.products.some(p=>p.id===product.id));
  assert.ok(prompt.initialEvidence.length);
  console.log(JSON.stringify({chatTest:{answered:true,sseEvents:events.length,restored:snapshot.contextMemory.restored,
    firstPlannerProductCount:prompt.productContext.products.length,firstPlannerEvidenceCount:prompt.initialEvidence.length},authorizationChecks:true}));
})().catch(error=>{console.error(JSON.stringify({error:'production_smoke_failed',phase,reason:error.name,
  endpoint:/^\/api\//.test(error.message)?error.message.slice(0,160):undefined}));process.exitCode=1;}).finally(async()=>{
  if(conversationId) {
    try{const removed=await request(`/api/chat/conversations/${conversationId}`,undefined,'DELETE');assert.equal(removed.status,204);console.log('Disposable verification conversation removed.');}
    catch{console.error('Verification conversation cleanup needs attention.');process.exitCode=1;}
  }
  await pool.end();
});
