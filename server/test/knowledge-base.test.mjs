import assert from 'node:assert/strict';
import test from 'node:test';
import 'reflect-metadata';
import { readFile, readdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { KnowledgeBaseService } from '../dist/documents/knowledge-base.service.js';
import { KnowledgeBaseController } from '../dist/documents/knowledge-base.controller.js';
import { DocumentService } from '../dist/documents/document.service.js';
import { SearchService } from '../dist/documents/search.service.js';
import { PERMISSION_KEY } from '../dist/admin/permission.decorator.js';
import { KnowledgeIndexService } from '../dist/documents/knowledge-index.service.js';
import { VersionSearchService } from '../dist/documents/version-search.service.js';
import { buildKnowledgeIndex } from '../dist/documents/build-knowledge-index.js';
import { FaqService } from '../dist/documents/faq.service.js';

test('knowledge base writes reject invalid configuration before accessing storage', async () => {
  const bases = new KnowledgeBaseService({});
  for (const input of [{ name: ' ' }, { name: 'ok', enabledForChat: 'true' }, { name: 'ok', secret: 'invalid' }]) {
    await assert.rejects(bases.create(1, input), (error) => error.getStatus() === 400);
  }
  await assert.rejects(bases.update(1, 1, {}), (error) => error.getStatus() === 400);
});

test('knowledge base publishing controls require management permission', () => {
  for (const method of ['create', 'update', 'archive']) {
    assert.deepEqual(Reflect.getMetadata(PERMISSION_KEY, KnowledgeBaseController.prototype[method]), ['knowledge_bases.manage']);
  }
  assert.deepEqual(Reflect.getMetadata(PERMISSION_KEY, KnowledgeBaseController.prototype.upload), ['documents.upload']);
});

test('knowledge base recall test searches only ready, active documents in the selected base', async () => {
  const statements = [];
  const database = { query: async (sql, values) => {
    statements.push({ sql, values });
    if (sql.includes('SELECT draft_config FROM knowledge_bases')) return { rows: [{ draft_config: {} }] };
    return { rows: [{ chunkId: 41, documentId: 8, documentTitle: '售后政策', originalFilename: 'returns.md',
      ordinal: 1, headingPath: '退货', content: '商品签收后七天内可申请退货。', sourceStartLine: 1, sourceEndLine: 1, score: 0.9 }] };
  } };
  const result = await new SearchService(database, { enabled: false }).recallTest(6, '退货期限', 5, 'fulltext');
  assert.equal(result.hits[0].documentId, 8);
  assert.equal(result.hits[0].matchType, '全文');
  assert.match(statements[1].sql, /d\.knowledge_base_id=\$2/);
  assert.deepEqual(statements[1].values.slice(0, 3), ['退货期限', 6, 0.15]);
  await assert.rejects(new SearchService(database, { enabled: false }).recallTest(6, 'x', 5), (error) => error.getStatus() === 400);
});

test('publishing a ready version switches the index and enables visitor QA in one update', async () => {
  const statements = [];
  const database = {
    transaction: (work) => work({ query: async (sql, values) => {
      statements.push({ sql, values });
      return sql.includes('UPDATE knowledge_bases') ? { rowCount: 1 } : { rows: [], rowCount: 1 };
    } }),
  };
  const indexes = new KnowledgeIndexService(database, {});
  assert.deepEqual(await indexes.activate(7, 3, 12), { id: 3, activeIndexVersionId: 12 });
  assert.match(statements[0].sql, /active_index_version_id=v\.id, enabled_for_chat=true/);
  assert.deepEqual(statements[0].values, [3, 12]);
});

// Opt-in integration test: runs migrations in a random schema inside a rolled-back
// transaction. Existing application tables and files are never modified.
test('PostgreSQL migration, document scope and chat visibility remain isolated', { skip: process.env.KB_INTEGRATION !== '1' }, async (t) => {
  const client = new Client({
    host: process.env.POSTGRES_HOST ?? 'localhost', port: Number(process.env.POSTGRES_PORT ?? 5433),
    user: process.env.POSTGRES_USER ?? 'grounded', password: process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DB ?? 'grounded_support',
  });
  const schema = `kb_test_${randomUUID().replaceAll('-', '')}`;
  const uploadRoot = await mkdtemp(join(tmpdir(), 'grounded-kb-test-'));
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET LOCAL search_path TO "${schema}", public`);
    const directory = new URL('../migrations/', import.meta.url);
    for (const file of (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort()) {
      if (file.startsWith('0012')) break;
      await client.query((await readFile(new URL(file, directory), 'utf8')).split('-- Down Migration')[0]);
    }
    const actor = (await client.query(`INSERT INTO admins (email, password_hash, display_name)
      VALUES ('fixture@example.invalid', 'not-a-password', 'fixture') RETURNING id`)).rows[0].id;
    await client.query(`INSERT INTO documents (title, original_filename, storage_key, sha256, byte_size, uploaded_by, status)
      VALUES ('原有资料', 'old.md', 'old.md', repeat('a', 64), 1, $1, 'ready')`, [actor]);
    await client.query(await readFile(new URL('0012_knowledge_bases.sql', directory), 'utf8'));
    for (const file of (await readdir(directory)).filter((name) => name.endsWith('.sql') && name > '0012_knowledge_bases.sql').sort()) {
      await client.query((await readFile(new URL(file, directory), 'utf8')).split('-- Down Migration')[0]);
    }
    const database = {
      query: (sql, values) => client.query(sql, values),
      transaction: async (work) => {
        await client.query('SAVEPOINT service_call');
        try { const result = await work(client); await client.query('RELEASE SAVEPOINT service_call'); return result; }
        catch (error) { await client.query('ROLLBACK TO SAVEPOINT service_call'); throw error; }
      },
    };
    const bases = new KnowledgeBaseService(database);
    const documents = new DocumentService(database, { enqueue: async () => {} }, { uploadRoot });
    const search = new SearchService(database, { enabled: false });
    const defaultBase = (await bases.list())[0];
    const second = await bases.create(actor, { name: '内部草稿' });
    assert.equal(second.enabledForChat, true, 'a new knowledge base is active without a publish step');
    assert.equal((await documents.list(50, 0)).length, 1);
    const file = { originalname: 'fixture.md', buffer: Buffer.from('隔离资料'), size: Buffer.byteLength('隔离资料') };
    const uploaded = await documents.upload(actor, file, '新资料', second.id);
    assert.equal((await documents.list(50, 0, second.id)).length, 1);
    assert.equal((await documents.list(50, 0)).length, 1);
    for (const action of [() => documents.get(uploaded.id), () => documents.listChunks(uploaded.id),
      () => documents.archive(actor, uploaded.id, defaultBase.id), () => documents.reprocess(actor, uploaded.id, defaultBase.id)]) {
      await assert.rejects(action(), (error) => error.getStatus() === 404);
    }
    await client.query("UPDATE documents SET status = 'ready' WHERE id = $1", [uploaded.id]);
    await client.query(`INSERT INTO document_chunks (document_id, ordinal, content, source_start_line, source_end_line)
      VALUES ($1, 1, '隔离资料', 1, 1)`, [uploaded.id]);
    assert.equal((await search.searchForAgent('隔离资料')).hits.length, 0);
    await bases.update(actor, second.id, { name: '已更名' });
    assert.equal((await bases.get(second.id)).enabledForChat, true);
    assert.equal((await search.searchForAgent('隔离资料')).hits.length, 1, 'ready documents enter chat retrieval automatically');
    assert.equal((await search.diagnose('隔离资料', 5, undefined)).results.length, 0);
    const faqs = new FaqService(database);
    const faqBase = await bases.create(actor, { name: 'FAQ 专用' });
    const faq = await faqs.save(actor,faqBase.id,{ question:'如何申请退货',answer:'七天内联系客服申请退货。' });
    const indexes = new KnowledgeIndexService(database, { enqueueIndex: async () => {} });
    await indexes.configure(actor,faqBase.id,{});
    const first = await indexes.build(actor,faqBase.id);
    await assert.rejects(indexes.build(actor,faqBase.id), (error) => error.getStatus()===409);
    const workerPool = { connect: async () => ({
      query: (sql, values) => client.query(sql==='BEGIN' ? 'SAVEPOINT worker_call' : sql==='COMMIT' ? 'RELEASE SAVEPOINT worker_call' : sql==='ROLLBACK' ? 'ROLLBACK TO SAVEPOINT worker_call' : sql,values),
      release() {},
    }) };
    // Economy must not access configuration or a remote provider at all.
    const runtime = { get embedding() { throw new Error('Economy called embedding'); } };
    await buildKnowledgeIndex(workerPool,first.id,runtime);
    const versionSearch = new VersionSearchService(database,runtime);
    assert.equal((await versionSearch.search('申请退货',5,faqBase.id)).hits.length,0);
    await indexes.activate(actor,faqBase.id,first.id);
    assert.equal((await bases.get(faqBase.id)).enabledForChat, true, 'publishing the first ready index also enables visitor QA');
    const found = await versionSearch.search('申请退货',5,faqBase.id);
    assert.equal(found.hits.length,1);
    assert.equal(found.hits[0].documentId,faq.documentId);
    assert.equal(found.embeddingCalls,0);
    assert.match(found.hits[0].content,/七天/);
    await faqs.save(actor,faqBase.id,{question:'如何申请退货',answer:'十四天内联系客服。'},faq.id);
    assert.match((await versionSearch.search('申请退货',5,faqBase.id)).hits[0].content,/七天/);
    const secondVersion = await indexes.build(actor,faqBase.id);
    await buildKnowledgeIndex(workerPool,secondVersion.id,runtime);
    await buildKnowledgeIndex(workerPool,secondVersion.id,runtime);
    await indexes.activate(actor,faqBase.id,secondVersion.id);
    assert.match((await versionSearch.search('申请退货',5,faqBase.id)).hits[0].content,/十四天/);
    await indexes.activate(actor,faqBase.id,first.id);
    assert.match((await versionSearch.search('申请退货',5,faqBase.id)).hits[0].content,/七天/);
    assert.match((await new SearchService(database,{enabled:false},versionSearch).searchForAgent('申请退货')).hits[0].content,/七天/);
    const embeddingRuntime = { embedding:{baseUrl:'https://embedding.example.invalid/v1',apiKey:'fake-key',connections:{}} };
    const embeddingSearch = new VersionSearchService(database,embeddingRuntime);
    const fetchMock=t.mock.method(globalThis,'fetch',async(_url,options)=>{
      const request=JSON.parse(options.body);
      const vector=request.model==='two-dimensional'?[1,0]:[1,0,0];
      return Response.json({data:request.input.map((_,index)=>({index,embedding:vector}))});
    });
    for(const dimensions of [2,3]) {
      const config={provider:'openai-compatible',baseUrl:embeddingRuntime.embedding.baseUrl,
        model:dimensions===2?'two-dimensional':'three-dimensional',dimensions,maxInputChars:8000,batchSize:16,secretRef:'default'};
      const profile=(await client.query("INSERT INTO embedding_profiles(name,config) VALUES('fixture',$1) RETURNING id::int",[config])).rows[0];
      await indexes.configure(actor,faqBase.id,{indexMode:'high_quality',retrievalMode:'hybrid',embeddingProfileId:profile.id});
      const next=await indexes.build(actor,faqBase.id);
      await buildKnowledgeIndex(workerPool,next.id,embeddingRuntime);
      const unpublished=await embeddingSearch.search('申请退货',5,faqBase.id,next.id);
      assert.equal(unpublished.vectorResults.length,1);
      assert.equal(unpublished.embeddingCalls,1);
      assert.equal(unpublished.hits[0].vectorRank,1);
      assert.equal(unpublished.hits[0].lexicalRank,1);
    }
    fetchMock.mock.mockImplementation(async()=>new Response('',{status:429}));
    const broken=await indexes.build(actor,faqBase.id);
    await assert.rejects(buildKnowledgeIndex(workerPool,broken.id,embeddingRuntime));
    assert.equal((await client.query('SELECT status FROM knowledge_index_versions WHERE id=$1',[broken.id])).rows[0].status,'failed');
    assert.equal((await bases.get(faqBase.id)).activeIndexVersionId,first.id);
    assert.match((await versionSearch.search('申请退货',5,faqBase.id)).hits[0].content,/七天/);
    await assert.rejects(indexes.activate(actor,faqBase.id,broken.id),(error)=>error.getStatus()===409);
    await assert.rejects(indexes.activate(actor,second.id,first.id),(error)=>error.getStatus()===409);
    await documents.archive(actor,faq.documentId,faqBase.id);
    assert.equal((await versionSearch.search('申请退货',5,faqBase.id)).hits.length,0);
    await bases.archive(actor, second.id);
    assert.equal((await search.searchForAgent('隔离资料')).hits.length, 0);
    await assert.rejects(documents.upload(actor, file, '拒绝上传', second.id), (error) => error.getStatus() === 404);
    await assert.rejects(bases.archive(actor, defaultBase.id), (error) => error.getStatus() === 409);
  } finally {
    await client.query('ROLLBACK');
    await client.end();
    await rm(uploadRoot, { recursive: true, force: true });
  }
});
