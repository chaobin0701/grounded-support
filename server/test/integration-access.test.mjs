import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { JwtService } from '@nestjs/jwt';
import { Module, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { IntegrationService, canonicalOrigin, credentialHash } from '../dist/integrations/integration.service.js';
import { IntegrationModule } from '../dist/integrations/integration.module.js';
import { AdminIntegrationController, WidgetSessionController } from '../dist/integrations/integration.controller.js';
import { AgentAccessGuard, LegacyWebsiteGuard } from '../dist/integrations/integration.guards.js';
import { AgentApiController } from '../dist/chat/agent-api.controller.js';
import { ChatController } from '../dist/chat/chat.controller.js';
import { IntegrationChatGateway } from '../dist/chat/integration-chat.gateway.js';
import { ConversationService } from '../dist/chat/conversation.service.js';
import { DatabaseService } from '../dist/database.service.js';
import { AppConfigService } from '../dist/config/config.service.js';
import { AdminAuthGuard } from '../dist/admin/admin-auth.guard.js';
import { PermissionGuard } from '../dist/admin/permission.guard.js';
import { OriginCheckGuard } from '../dist/security/origin-check.guard.js';
import { PERMISSION_KEY } from '../dist/admin/permission.decorator.js';
import { modelInputReservation } from '../dist/chat/model-call-accounting.js';
import { HttpExceptionFilter } from '../dist/security/http-exception.filter.js';
import { LlmService } from '../dist/chat/llm.service.js';

test('authorized origins are exact, canonical and never wildcard/path/credential redirects', () => {
  assert.equal(canonicalOrigin('https://SHOP.example:443/'), 'https://shop.example');
  assert.equal(canonicalOrigin('http://localhost:8849'), 'http://localhost:8849');
  assert.equal(canonicalOrigin('http://[::1]:8849'), 'http://[::1]:8849');
  for (const origin of ['*','null','https://*.example','http://public.example','https://a.example/path','https://user:secret@a.example','https://a.example?x=1','https://a.example#frag']) {
    assert.throws(() => canonicalOrigin(origin));
  }
});

test('credential fingerprints are one-way and separate; bootstrap limits are bounded', () => {
  assert.match(credentialHash('never-stored-plaintext'), /^[0-9a-f]{64}$/);
  assert.notEqual(credentialHash('key-1'), credentialHash('key-2'));
  const access = new IntegrationService({}, {}, {});
  for (let i=0;i<20;i++) access.checkVisitorBootstrap('one-address');
  assert.throws(() => access.checkVisitorBootstrap('one-address'), e => e.getStatus() === 429);
  const identity={app:{id:'fixture'},kind:'api',keyId:'fixture-key'};
  for(let i=0;i<60;i++)access.checkInspectionRate(identity);
  assert.throws(()=>access.checkInspectionRate(identity),e=>e.getResponse().code==='inspection_rate_limit');
  access.checkInspectionRate({...identity,keyId:'independent-key'});
});

test('admin access is explicitly protected; scoped origin checks are delegated, not disabled globally', () => {
  assert.deepEqual(Reflect.getMetadata(PERMISSION_KEY, AdminIntegrationController.prototype.create), ['integrations.manage']);
  assert.deepEqual(Reflect.getMetadata(PERMISSION_KEY, AdminIntegrationController.prototype.list), ['integrations.read','integrations.manage']);
  assert.ok(Reflect.getMetadata('imports', IntegrationModule).length);
  const guard = new OriginCheckGuard({ security: { allowedOrigins: ['https://admin.example'] } });
  const context = path => ({ switchToHttp: () => ({ getRequest: () => ({ method:'POST',path,headers:{origin:'https://external.example'} }) }) });
  assert.equal(guard.canActivate(context('/api/v1/agent/messages')), true);
  assert.equal(guard.canActivate(context('/api/widget/session')), true);
  assert.throws(() => guard.canActivate(context('/api/admin/integrations')), e => e.getStatus() === 403);
});

// Uses an isolated, randomly named schema. No existing application/user data is read or modified.
test('integration migration, authorization, isolation, quotas, idempotency and SSE in PostgreSQL/HTTP', { skip: !process.env.TEST_DATABASE_URL, timeout:60000 }, async t => {
  const schema = `integration_test_${randomUUID().replaceAll('-','')}`;
  const rootPool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL });
  let db, app;
  try {
    await rootPool.query(`CREATE SCHEMA ${schema}`);
    const connection = new URL(process.env.TEST_DATABASE_URL);
    connection.searchParams.set('options', `-csearch_path=${schema}`);
    db = new DatabaseService({ databaseUrl:connection.toString() });
    await db.onModuleInit();
    await db.query(`CREATE TABLE admins(id integer PRIMARY KEY,email text,display_name text,disabled_at timestamptz);
      INSERT INTO admins VALUES(1,'fixture@example.invalid','fixture',NULL),(2,'reader@example.invalid','reader',NULL);
      CREATE TABLE roles(id integer PRIMARY KEY,code text); INSERT INTO roles VALUES(1,'super_admin'),(2,'reader');
      CREATE TABLE permissions(code varchar(100) PRIMARY KEY,description text);
      CREATE TABLE role_permissions(role_id integer REFERENCES roles(id),permission_code varchar(100) REFERENCES permissions(code),PRIMARY KEY(role_id,permission_code));
      CREATE TABLE admin_roles(admin_id integer,role_id integer); INSERT INTO admin_roles VALUES(1,1),(2,2);
      CREATE TABLE audit_logs(id serial,actor_admin_id integer,action text,target_type text,target_id text,details jsonb);`);
    for (const file of ['0006_chat_conversations.sql','0011_session_recovery.sql']) {
      const migration = await readFile(new URL(`../migrations/${file}`, import.meta.url),'utf8');
      await db.query(migration.split('-- Down Migration')[0]);
    }
    await db.query(`ALTER TABLE visitor_sessions ADD COLUMN client_type text NOT NULL DEFAULT 'browser';
      ALTER TABLE conversation_messages ADD COLUMN tool_steps jsonb NOT NULL DEFAULT '[]', ADD COLUMN progress_events jsonb NOT NULL DEFAULT '[]';
      ALTER TABLE chat_traces ADD COLUMN kind text NOT NULL DEFAULT 'answer';`);
    const migration = await readFile(new URL('../migrations/0030_integration_access.sql',import.meta.url),'utf8');
    await db.query(migration.split('-- Down Migration')[0]);
    const tokenMigration = await readFile(new URL('../migrations/0031_integration_token_quota.sql',import.meta.url),'utf8');
    await db.query(tokenMigration.split('-- Down Migration')[0]);
    const productContextMigration = await readFile(new URL('../migrations/0032_message_product_context.sql',import.meta.url),'utf8');
    await db.query(productContextMigration.split('-- Down Migration')[0]);
    const config = { jwt:{ issuer:'fixture',audience:'fixture-admin' },security:{ allowedOrigins:['https://shop.example'] } };
    const jwt = new JwtService({ secret:'isolated-test-secret-never-for-production-32',signOptions:{issuer:config.jwt.issuer,audience:config.jwt.audience,expiresIn:300} });
    const access = new IntegrationService(db,jwt,config);
    const conversations = new ConversationService(db,{},{});
    let modelCalls = 0;
    let lastContext;
    let budgetModelCalls=0;
    const budgetLlm=new LlmService({model:'budget-fixture',maxOutputTokens:20,
      chat:async()=>{budgetModelCalls++;return {content:'ok',model:'budget-fixture',toolCalls:[],usage:{inputTokens:8,outputTokens:3,totalTokens:11},finishReason:'stop'};},
      async *stream(){budgetModelCalls++;yield {type:'text_delta',delta:'ok'};yield {type:'completed',usage:{inputTokens:8,outputTokens:3,totalTokens:11},finishReason:'stop'};}
    });
    const application = { ask:async(message,callbacks) => {
      modelCalls++;
      lastContext = message.context;
      if (message.question === 'simulate failure') throw new Error('private provider error must never escape');
      if (message.question === 'budget flow') {
        await budgetLlm.completeDetailed('system','question','budget-fixture','planner');
        await budgetLlm.streamText('system','tool results '.repeat(1000),text=>callbacks?.onAnswerDelta?.(text));
      }
      callbacks?.onAnswerStarted?.({citations:[]}); callbacks?.onAnswerDelta?.('测试');
      await new Promise(r=>setTimeout(r,25)); callbacks?.onAnswerDelta?.('回答');
      const runId=randomUUID(),traceId=randomUUID();
      const user=await db.query(`INSERT INTO conversation_messages(conversation_id,role,content,request_context) VALUES($1,'user',$2,$3::jsonb) RETURNING id`,[message.conversationId,message.question,JSON.stringify(message.context ?? {})]);
      const assistant=await db.query(`INSERT INTO conversation_messages(conversation_id,role,content,refused) VALUES($1,'assistant','测试回答',false) RETURNING id`,[message.conversationId]);
      await db.query(`INSERT INTO conversation_runs(id,conversation_id,client_request_id,question,status,expires_at,finished_at,user_message_id,assistant_message_id) VALUES($1,$2,$3,$4,'completed',now(),now(),$5,$6)`,[runId,message.conversationId,message.clientRequestId,message.question,user.rows[0].id,assistant.rows[0].id]);
      await db.query(`INSERT INTO chat_traces(id,conversation_id,user_message_id,question,final_answer,status,refused,total_tokens,duration_ms) VALUES($1,$2,$3,$4,'测试回答','completed',false,7,25)`,[traceId,message.conversationId,user.rows[0].id,message.question]);
      return {answer:'测试回答',refused:false,citations:[],toolSteps:[{arguments:{private:'internal'}}]};
    } };
    const gateway=new IntegrationChatGateway(access,application,db);
    const rateLimit={run:(_ip,task)=>task(),runPlatform:task=>task()};
    class FixtureModule {}
    Module({ controllers:[AdminIntegrationController,WidgetSessionController,AgentApiController,ChatController],providers:[
      {provide:DatabaseService,useValue:db},{provide:AppConfigService,useValue:config},{provide:JwtService,useValue:jwt},
      {provide:IntegrationService,useValue:access},AgentAccessGuard,LegacyWebsiteGuard,AdminAuthGuard,PermissionGuard,
      {provide:ConversationService,useValue:conversations},{provide:IntegrationChatGateway,useValue:gateway},
      {provide:(await import('../dist/chat/chat-rate-limit.service.js')).ChatRateLimitService,useValue:rateLimit},
      {provide:(await import('../dist/chat/chat-application.service.js')).ChatApplicationService,useValue:application},
      {provide:(await import('../dist/chat/chat.service.js')).ChatService,useValue:{}},
    ] })(FixtureModule);
    app=await NestFactory.create(FixtureModule,{logger:false});
    app.setGlobalPrefix('api'); app.useGlobalPipes(new ValidationPipe({whitelist:true,forbidNonWhitelisted:true,transform:true}));
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalGuards(new OriginCheckGuard(config));
    app.enableCors({origin:(_origin,cb)=>cb(null,true)});
    await app.listen(0,'127.0.0.1');
    const base=await app.getUrl();
    const adminToken=await jwt.signAsync({sub:'1'}),readerToken=await jwt.signAsync({sub:'2'});
    async function http(path,{token,origin,body,method='GET',key,...rest}={}) {
      return fetch(base+'/api'+path,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...(token?{Authorization:`Bearer ${token}`}:{ }),...(origin?{Origin:origin}:{}),...(key?{'Idempotency-Key':key}:{}),...rest.headers},...(body?{body:JSON.stringify(body)}:{})});
    }
    const input={name:'fixture',enabled:true,websiteEnabled:true,apiEnabled:true,allowedOrigins:['https://shop.example'],scopes:['chat:write','conversations:read','conversations:delete','usage:read'],requestsPerMinute:100,concurrency:5,dailyRequests:100,dailyTokenLimit:null};
    const external=await access.save(1,input),other=await access.save(1,{...input,name:'other'});
    const key=await access.createKey(1,external.id,{name:'fixture key',scopes:input.scopes});
    const keyB=await access.createKey(1,other.id,{name:'other key',scopes:input.scopes});
    let result,widget,owner,requestCount;

    await t.test('401/403, scoped endpoints, strict DTO and hashed-only key storage',async()=>{
      assert.equal((await http('/admin/integrations')).status,401);
      assert.equal((await http('/admin/integrations',{token:readerToken})).status,403);
      assert.equal((await http('/admin/integrations',{token:key.apiKey})).status,401);
      assert.equal((await http('/v1/agent/messages',{method:'POST',token:adminToken,body:{userId:'u',message:'hello'}})).status,401);
      assert.equal((await http('/v1/agent/messages',{method:'POST',token:key.apiKey,origin:'https://shop.example',body:{userId:'u',message:'hello'}})).status,403);
      assert.equal((await http('/v1/agent/conversations?userId=u',{token:key.apiKey,headers:{'Sec-Fetch-Site':'same-origin'}})).status,403);
      assert.equal((await http('/v1/agent/messages',{method:'POST',token:key.apiKey,body:{userId:'u',message:'hello',appId:other.id}})).status,400);
      const row=(await db.query('SELECT secret_hash,masked_key FROM integration_api_keys WHERE id=$1',[key.id])).rows[0];
      assert.equal(row.secret_hash,credentialHash(key.apiKey)); assert.ok(!row.masked_key.includes(key.apiKey));
      const detail=await access.detail(external.id); assert.equal(JSON.stringify(detail).includes(key.apiKey),false);
      assert.equal((await http('/admin/integrations/'+external.id,{token:adminToken})).headers.get('cache-control'),'no-store');
    });
    await t.test('JSON call creates one owned conversation, exact trace/run IDs; idempotency works even on first send',async()=>{
      const response=await http('/v1/agent/messages',{method:'POST',token:key.apiKey,key:'first-send',body:{userId:'alice',message:'hello there'}});
      assert.equal(response.status,200); result=await response.json();
      assert.ok(result.runId&&result.traceId&&result.conversationId); assert.equal(result.toolSteps,undefined);
      requestCount=modelCalls;
      const replay=await http('/v1/agent/messages',{method:'POST',token:key.apiKey,key:'first-send',body:{userId:'alice',message:'hello there'}});
      assert.deepEqual(await replay.json(),result); assert.equal(modelCalls,requestCount);
      assert.equal((await http('/v1/agent/messages',{method:'POST',token:key.apiKey,key:'first-send',body:{userId:'alice',message:'changed question'}})).status,409);
      const ownership=(await db.query('SELECT visitor_session_id,application_id FROM conversations WHERE id=$1',[result.conversationId])).rows[0];
      assert.equal(ownership.application_id,external.id); owner=ownership.visitor_session_id;
      assert.equal((await db.query('SELECT application_id FROM chat_traces WHERE id=$1',[result.traceId])).rows[0].application_id,external.id);
    });
    await t.test('other user/application cannot read, write, delete or inspect runs',async()=>{
      for (const token of [key.apiKey,keyB.apiKey]) {
        const userId=token===key.apiKey?'bob':'alice';
        for(const suffix of ['messages','runs']) assert.equal((await http(`/v1/agent/conversations/${result.conversationId}/${suffix}?userId=${userId}`,{token})).status,404);
        assert.equal((await http(`/v1/agent/conversations/${result.conversationId}?userId=${userId}`,{token,method:'DELETE'})).status,404);
        assert.equal((await http('/v1/agent/messages',{token,method:'POST',body:{userId,conversationId:result.conversationId,message:'hello again'}})).status,404);
      }
      assert.equal((await http(`/v1/agent/conversations/${result.conversationId}/messages?userId=alice`,{token:key.apiKey})).status,200);
    });
    await t.test('product context crosses HTTP/gateway, is saved, deduplicated and participates in idempotency', async () => {
      const body={userId:'products-fixture',message:'产品有什么区别？',context:{productIds:['1','2','1']}};
      const response=await http('/v1/agent/messages',{method:'POST',token:key.apiKey,key:'products-fixture',body});
      assert.equal(response.status,200); const result=await response.json();
      assert.deepEqual(lastContext,{productIds:['1','2']}); const count=modelCalls;
      const replay=await http('/v1/agent/messages',{method:'POST',token:key.apiKey,key:'products-fixture',body:{...body,context:{productIds:['2','1']}}});
      assert.deepEqual(await replay.json(),result); assert.equal(modelCalls,count);
      assert.equal((await http('/v1/agent/messages',{method:'POST',token:key.apiKey,key:'products-fixture',body:{...body,context:{productIds:['3']}}})).status,409);
      const history=await http(`/v1/agent/conversations/${result.conversationId}/messages?userId=products-fixture`,{token:key.apiKey});
      assert.deepEqual((await history.json())[0].context,{productIds:['1','2']});
      for(const context of [{productIds:['1','2','3','4','5','6']},{productIds:[1]},{productIds:'1'},{productIds:['1'],specifications:{price:'1'}}]) {
        assert.equal((await http('/v1/agent/messages',{method:'POST',token:key.apiKey,body:{...body,context}})).status,400);
      }
      assert.equal(modelCalls,count);
    });
    await t.test('inline reference offsets survive HTTP and message persistence; invalid positions never call the model', async () => {
      const context={productIds:['1','2'],productReferences:[{productId:'1',offset:1},{productId:'2',offset:4}]};
      const body={userId:'inline-fixture',message:'前🙂\n后',context};
      const response=await http('/v1/agent/messages',{method:'POST',token:key.apiKey,key:'inline-fixture',body});
      assert.equal(response.status,200); const result=await response.json(); const count=modelCalls;
      assert.deepEqual(lastContext,context);
      const history=await http(`/v1/agent/conversations/${result.conversationId}/messages?userId=inline-fixture`,{token:key.apiKey});
      assert.deepEqual((await history.json())[0].context,context);
      for(const references of [[{productId:'missing',offset:0}],[{productId:'1',offset:6}],[{productId:'1',offset:0},{productId:'1',offset:1}]]) {
        assert.equal((await http('/v1/agent/messages',{method:'POST',token:key.apiKey,body:{...body,context:{productIds:['1'],productReferences:references}}})).status,400);
      }
      assert.equal(modelCalls,count);
    });
    await t.test('readable product text and styling ranges survive HTTP, persistence and idempotent replay', async () => {
      const context={productIds:['1'],productReferences:[{productId:'1',offset:8,length:5}]};
      const body={userId:'range-fixture',message:'这个产品怎么样\n米家电暖器',context};
      const response=await http('/v1/agent/messages',{method:'POST',token:key.apiKey,key:'range-fixture',body});
      assert.equal(response.status,200); const result=await response.json(); const count=modelCalls;
      assert.deepEqual(lastContext,context);
      const history=await http(`/v1/agent/conversations/${result.conversationId}/messages?userId=range-fixture`,{token:key.apiKey});
      const user=(await history.json())[0]; assert.equal(user.content,body.message); assert.deepEqual(user.context,context);
      const replay=await http('/v1/agent/messages',{method:'POST',token:key.apiKey,key:'range-fixture',body});
      assert.deepEqual(await replay.json(),result);
      assert.equal((await http('/v1/agent/messages',{method:'POST',token:key.apiKey,key:'range-fixture',body:{...body,context:{productIds:['1'],productReferences:[{productId:'1',offset:8}]}}})).status,409);
      for(const productReferences of [[{productId:'1',offset:8,length:6}],[{productId:'1',offset:8,length:0}],[{productId:'1',offset:8,length:0.5}],[{productId:'1',offset:8,length:5},{productId:'2',offset:9,length:2}]]) {
        assert.equal((await http('/v1/agent/messages',{method:'POST',token:key.apiKey,body:{...body,context:{productIds:['1','2'],productReferences}}})).status,400);
      }
      assert.equal(modelCalls,count);
    });
    await t.test('visitor tokens bind origin/application/subject and resume without an empty conversation',async()=>{
      const before=(await db.query('SELECT count(*)::int AS count FROM conversations')).rows[0].count;
      const session=await http('/widget/session',{method:'POST',origin:'https://shop.example',body:{appId:external.id}}); assert.equal(session.status,201); widget=await session.json();
      assert.equal((await db.query('SELECT count(*)::int AS count FROM conversations')).rows[0].count,before);
      assert.equal((await http('/widget/session',{method:'POST',origin:'https://shop.example.evil',body:{appId:external.id}})).status,403);
      assert.equal((await http('/widget/session',{method:'POST',body:{appId:external.id}})).status,403);
      assert.equal((await http('/v1/agent/messages',{token:widget.accessToken,origin:'https://shop.example',method:'POST',body:{userId:'alice',message:'hello'}})).status,400);
      assert.equal((await http('/v1/agent/conversations',{token:widget.accessToken,origin:'https://other.example'})).status,403);
      assert.equal((await http('/v1/agent/conversations',{token:widget.accessToken,headers:{'Sec-Fetch-Site':'same-origin',Referer:'https://shop.example/page'}})).status,200);
      assert.equal((await http('/v1/agent/conversations',{token:widget.accessToken})).status,403);
      const again=await access.widgetSession({headers:{origin:'https://shop.example'},ip:'resume-fixture'},external.id,widget.resumeToken);
      assert.equal(jwt.decode(again.accessToken).sub,jwt.decode(widget.accessToken).sub);
    });
    await t.test('SSE forwards model deltas; final payload omits internal tool arguments',async()=>{
      const response=await http('/v1/agent/messages',{token:widget.accessToken,origin:'https://shop.example',method:'POST',body:{message:'hello streamed',stream:true}});
      assert.equal(response.status,200); assert.match(response.headers.get('content-type'),/text\/event-stream/);
      const text=await response.text(); assert.equal((text.match(/event: answer_delta/g)||[]).length,2); assert.match(text,/event: run_started/); assert.match(text,/event: done/); assert.ok(!text.includes('internal'));
      assert.match(text,/"usage":/);
    });
    await t.test('status and scoped usage never leak other visitors, application secrets or internal contexts',async()=>{
      const all=await http('/v1/agent/usage',{token:key.apiKey}); assert.equal(all.status,200);
      const aggregate=await all.json();assert.equal(aggregate.scope,'application');assert.ok(aggregate.totalTokens>=14);assert.equal(aggregate.timezone,'Asia/Shanghai');assert.ok(aggregate.resetAt);
      const own=await http('/v1/agent/usage',{token:widget.accessToken,origin:'https://shop.example'});assert.equal(own.status,200);
      const personal=await own.json();assert.equal(personal.scope,'visitor');assert.equal(personal.requests,1);assert.equal(personal.tokenLimit,null);assert.equal(personal.remainingTokens,null);assert.equal(personal.totalTokens,7);
      const state=await http('/v1/agent/status',{token:widget.accessToken,origin:'https://shop.example'}).then(r=>r.json());assert.equal(state.canSend,true);assert.equal(state.modelHealth,'not_probed');
      assert.equal(JSON.stringify(state).includes('database'),false);assert.equal(JSON.stringify(aggregate).includes(key.apiKey),false);
      const noUsage=await access.createKey(1,external.id,{name:'no-usage',scopes:['chat:write']});
      assert.equal((await http('/v1/agent/usage',{token:noUsage.apiKey})).status,403);
      assert.equal((await http('/v1/agent/status',{token:noUsage.apiKey})).status,200);
      assert.equal((await http('/v1/agent/usage',{token:keyB.apiKey})).status,200);
      assert.equal((await http('/v1/agent/usage',{token:keyB.apiKey}).then(r=>r.json())).totalTokens,0);
      assert.equal((await http('/v1/agent/usage',{token:widget.accessToken,origin:'https://shop.example',headers:{'x-user-id':owner}}).then(r=>r.json())).totalTokens,7);
    });
    await t.test('daily token reservations are atomic; actual, missing, expired and late usage settle exactly once',async()=>{
      const request={model:'fixture',messages:[{role:'user',content:'question'}],maxTokens:1200};
      const amount=modelInputReservation(request)+request.maxTokens;
      const limited=await access.save(1,{...input,name:'tokens',dailyTokenLimit:amount+100});
      const limitedKey=await access.createKey(1,limited.id,{name:'tokens',scopes:input.scopes});
      const identity=await access.authenticate({headers:{authorization:`Bearer ${limitedKey.apiKey}`}});
      const owned=await access.platformOwner(identity,'user');
      const admissions=await Promise.all(['one','two'].map(k=>access.admit(identity,owned,undefined,'question',k)));
      const leases=await Promise.allSettled(admissions.map(a=>access.tokens.accounting(limited.id,a.callId).reserve(request,'planner')));
      assert.equal(leases.filter(r=>r.status==='fulfilled').length,1);assert.equal(leases.find(r=>r.status==='rejected').reason.getStatus(),429);
      assert.equal((await access.detail(limited.id)).usage.reservedTokens,amount);
      const lease=leases.find(r=>r.status==='fulfilled').value;
      await lease.settle({inputTokens:8,outputTokens:3,totalTokens:11});
      await lease.settle({inputTokens:99,outputTokens:99,totalTokens:198}); // duplicate settlement must be a no-op
      assert.equal((await access.detail(limited.id)).usage.totalTokens,11);
      const unknown=await access.tokens.accounting(limited.id,admissions[0].callId).reserve(request,'answer');
      await unknown.settle(null,new Error('network interrupted'));
      const usage=(await access.detail(limited.id)).usage;assert.equal(usage.totalTokens,amount+11);assert.equal(usage.reservedTokens,0);assert.equal(usage.unknownModelCalls,1);
      await assert.rejects(access.tokens.accounting(limited.id,admissions[1].callId).reserve(request,'answer'),e=>e.getResponse().code==='daily_token_budget_insufficient');
      await access.save(1,{...input,name:'tokens',dailyTokenLimit:amount+11},limited.id);
      const legacyInput={...input,name:'tokens'};delete legacyInput.dailyTokenLimit;
      assert.equal((await access.save(1,legacyInput,limited.id)).dailyTokenLimit,amount+11);
      const blocked=await http('/v1/agent/messages',{token:limitedKey.apiKey,method:'POST',body:{userId:'user',message:'hello',stream:true}});
      assert.equal(blocked.status,429);const quotaError=await blocked.json();assert.equal(quotaError.error.code,'daily_token_quota_exceeded');assert.ok(quotaError.error.retryAt);assert.ok(blocked.headers.get('retry-after'));
      assert.equal((await http('/v1/agent/status',{token:limitedKey.apiKey}).then(r=>r.json())).canSend,false);
      for(const a of admissions)await access.finish(a.callId,null);
      // A new day has a fresh budget; old unknown consumption remains auditable.
      await db.query("UPDATE integration_model_calls SET quota_day=(now() AT TIME ZONE 'Asia/Shanghai')::date-1 WHERE app_id=$1",[limited.id]);
      assert.equal((await access.detail(limited.id)).usage.totalTokens,0);
      assert.equal((await http('/v1/agent/status',{token:limitedKey.apiKey}).then(r=>r.json())).canSend,true);

      const next=await access.admit(identity,owned,undefined,'question','late');
      const late=await access.tokens.accounting(limited.id,next.callId).reserve(request,'planner');
      await db.query("UPDATE integration_model_calls SET expires_at=now()-interval '1 second' WHERE call_id=$1",[next.callId]);
      assert.equal((await access.detail(limited.id)).usage.totalTokens,amount);assert.equal((await access.detail(limited.id)).usage.reservedTokens,0);
      await late.settle({inputTokens:3,outputTokens:2,totalTokens:5});
      assert.equal((await access.detail(limited.id)).usage.totalTokens,5);
      await access.finish(next.callId,{conversationId:next.conversationId,runId:null,traceId:null,status:'completed',answer:'ok',refused:false,citations:[]});
      const summary=await access.tokens.accounting(limited.id,next.callId).reserve({...request,maxTokens:800},'summary');
      await summary.settle({inputTokens:4,outputTokens:2,totalTokens:6});
      assert.equal((await access.tokens.callUsage(next.callId)).totalTokens,11);assert.equal((await access.tokens.callUsage(next.callId)).includesSummary,true);
      assert.equal((await db.query('SELECT total_tokens FROM integration_calls WHERE id=$1',[next.callId])).rows[0].total_tokens,'11');
      const partial=await access.tokens.accounting(limited.id,next.callId).reserve({...request,maxTokens:20},'summary');
      await partial.settle({inputTokens:5,outputTokens:null,totalTokens:8});
      assert.equal((await access.tokens.callUsage(next.callId)).totalTokens,19);assert.equal((await access.tokens.callUsage(next.callId)).accounting,'incomplete');
      const inconsistent=await access.tokens.accounting(limited.id,next.callId).reserve({...request,maxTokens:20},'summary');
      await inconsistent.settle({inputTokens:5,outputTokens:2,totalTokens:1});
      assert.equal((await access.tokens.callUsage(next.callId)).totalTokens,26);
    });
    await t.test('invalid token limits are rejected by HTTP validation without changing configuration',async()=>{
      for(const limit of [0,-1,1.5,1000000000001,'1000'])assert.equal((await http('/admin/integrations',{token:adminToken,method:'POST',body:{...input,dailyTokenLimit:limit}})).status,400);
      assert.equal((await http('/admin/integrations',{token:adminToken,method:'POST',body:{...input,maxRunTokens:1000}})).status,400);
    });
    await t.test('quota depleted between planner and final stream emits a resource error, retaining paid usage',async()=>{
      const first={model:'budget-fixture',messages:[{role:'system',content:'system'},{role:'user',content:'question'}],maxTokens:20};
      const limited=await access.save(1,{...input,name:'stream-budget',dailyTokenLimit:modelInputReservation(first)+120});
      const limitedKey=await access.createKey(1,limited.id,{name:'stream-budget',scopes:input.scopes});
      const before=budgetModelCalls;
      const response=await http('/v1/agent/messages',{token:limitedKey.apiKey,method:'POST',body:{userId:'one',message:'budget flow',stream:true}});
      assert.equal(response.status,200);const text=await response.text();
      assert.match(text,/event: error/);assert.match(text,/daily_token_budget_insufficient/);assert.match(text,/今日剩余 Token 额度不足/);assert.ok(!text.includes('event: done'));assert.ok(!text.includes('"refused":true'));
      assert.equal(budgetModelCalls-before,1);
      const detail=await access.detail(limited.id);assert.equal(detail.usage.totalTokens,11);assert.equal(detail.usage.reservedTokens,0);assert.equal(detail.usage.failed,1);
    });
    await t.test('legacy routes cannot bypass app auth or resource ownership, and keep cookies scoped',async()=>{
      assert.equal((await http('/chat',{method:'POST',body:{question:'hello'}})).status,403);
      assert.equal((await http('/chat/stream',{method:'POST',token:key.apiKey,body:{question:'hello'}})).status,403);
      const r=await http('/chat/conversations',{origin:'https://shop.example'}); assert.equal(r.status,200); assert.match(r.headers.get('set-cookie'),/HttpOnly/);
      const cookie=r.headers.get('set-cookie').split(';')[0];
      const ownUsage=await http('/chat/usage',{origin:'https://shop.example',headers:{Cookie:cookie}});
      assert.equal(ownUsage.status,200);assert.equal(ownUsage.headers.get('cache-control'),'no-store');
      const ownSnapshot=await ownUsage.json();assert.equal(ownSnapshot.scope,'visitor');assert.equal(ownSnapshot.requests,0);assert.equal(ownSnapshot.tokenLimit,null);
      const quota=await http('/chat/quota',{origin:'https://shop.example',headers:{Cookie:cookie}});
      assert.equal(quota.status,200);assert.equal(quota.headers.get('cache-control'),'no-store');
      const budget=await quota.json();assert.equal(budget.scope,'website-shared');assert.ok(budget.requestLimit>0);assert.equal(budget.tokenLimit,null);
      assert.ok(!JSON.stringify(budget).includes(cookie));assert.equal(budget.ownerId,undefined);assert.equal(budget.allowedOrigins,undefined);
      assert.equal((await http('/chat/status',{origin:'https://shop.example',headers:{Cookie:cookie}})).status,200);
      assert.equal((await http('/chat/quota',{origin:'https://other.example',headers:{Cookie:cookie}})).status,403);
      assert.equal((await http('/chat/quota',{origin:'https://shop.example',token:key.apiKey})).status,403);
      assert.equal((await http(`/chat/conversations/${result.conversationId}/messages`,{origin:'https://shop.example'})).status,404);
    });
    await t.test('revocation, rotation, expiry, disabled apps and changed domain config invalidate access',async()=>{
      const readKey=await access.createKey(1,external.id,{name:'read-only',scopes:['conversations:read']});
      assert.equal((await http('/v1/agent/messages',{token:readKey.apiKey,method:'POST',body:{userId:'alice',message:'hello'}})).status,403);
      const rotated=await access.createKey(1,external.id,{name:'replacement',scopes:input.scopes},readKey.id);
      assert.equal((await http('/v1/agent/conversations?userId=alice',{token:readKey.apiKey})).status,401);
      assert.equal((await http('/v1/agent/conversations?userId=alice',{token:rotated.apiKey})).status,200);
      await db.query("UPDATE integration_api_keys SET expires_at=now()-interval '1 second' WHERE id=$1",[rotated.id]);
      assert.equal((await http('/v1/agent/conversations?userId=alice',{token:rotated.apiKey})).status,401);
      await access.revokeKey(1,external.id,rotated.id);
      await access.save(1,{...input,allowedOrigins:['https://new.example']},external.id);
      assert.equal(await access.allowedOrigin('https://shop.example.evil'),false);
      assert.equal((await http('/v1/agent/conversations',{token:widget.accessToken,origin:'https://shop.example'})).status,403);
      await access.save(1,{...input,enabled:false},external.id);
      assert.equal((await http('/v1/agent/conversations?userId=alice',{token:key.apiKey})).status,403);
      await access.save(1,input,external.id);
    });
    await t.test('quota/concurrency admission is atomic, completed retries are free; failure releases slot',async()=>{
      const limited=await access.save(1,{...input,name:'limits',requestsPerMinute:2,concurrency:1,dailyRequests:2});
      const limitedKey=await access.createKey(1,limited.id,{name:'limited',scopes:input.scopes});
      const identity=await access.authenticate({headers:{authorization:`Bearer ${limitedKey.apiKey}`}});
      const owned=await access.platformOwner(identity,'one');
      const contenders=await Promise.allSettled([access.admit(identity,owned,undefined,'question one','q1'),access.admit(identity,owned,undefined,'question two','q2')]);
      assert.equal(contenders.filter(r=>r.status==='fulfilled').length,1); assert.equal(contenders.find(r=>r.status==='rejected').reason.getStatus(),429);
      const admission=contenders.find(r=>r.status==='fulfilled').value;
      await access.finish(admission.callId,null);
      const next=await access.admit(identity,owned,undefined,'question three','q3'); await access.finish(next.callId,null);
      await assert.rejects(access.admit(identity,owned,undefined,'question four','q4'),e=>e.getStatus()===429);
      const failed=await http('/v1/agent/messages',{token:key.apiKey,method:'POST',key:'failure',body:{userId:'alice',message:'simulate failure',stream:true}});
      const text=await failed.text(); assert.match(text,/event: error/); assert.ok(!text.includes('private provider'));
      assert.equal((await db.query("SELECT count(*)::int AS count FROM integration_calls WHERE app_id=$1 AND status='running'",[external.id])).rows[0].count,0);
      assert.equal((await http('/v1/agent/messages',{token:key.apiKey,method:'POST',key:'first-send',body:{userId:'alice',message:'hello there'}})).status,200);
    });
    await t.test('stats and audit use real calls, preserve metadata and never contain plaintext secrets',async()=>{
      const detail=await access.detail(external.id); assert.ok(detail.usage.requests>=3); assert.ok(detail.usage.failed>=1); assert.ok(Number(detail.usage.totalTokens)>=14);
      const logs=(await db.query('SELECT action,details FROM audit_logs')).rows;
      assert.ok(logs.some(l=>l.action==='integration.key_rotated')); assert.ok(logs.some(l=>l.action==='integration.key_revoked'));
      assert.ok(!JSON.stringify(logs).includes(key.apiKey));
      await db.query(tokenMigration.split('-- Down Migration')[1]);
      const down=migration.split('-- Down Migration')[1]; await db.query(down); // Validate reversible migration too.
    });
  } finally {
    try { if (app) await app.close(); else if (db) await db.onModuleDestroy(); }
    finally { await rootPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await rootPool.end(); }
  }
});
