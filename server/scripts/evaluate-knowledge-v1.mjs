import 'reflect-metadata';
import { readFile,readdir } from 'node:fs/promises';
import { randomUUID,createHash } from 'node:crypto';
import { Client } from 'pg';
import { KnowledgeBaseService } from '../dist/documents/knowledge-base.service.js';
import { KnowledgeIndexService } from '../dist/documents/knowledge-index.service.js';
import { VersionSearchService } from '../dist/documents/version-search.service.js';
import { FaqService } from '../dist/documents/faq.service.js';
import { parseDocument } from '../dist/documents/extract-document.js';
import { buildKnowledgeIndex } from '../dist/documents/build-knowledge-index.js';

// Real PostgreSQL FTS/trigram retrieval, isolated from application data. No fake search results.
const fixture=JSON.parse(await readFile(new URL('../../samples/eval/knowledge-v1.json',import.meta.url),'utf8'));
const client=new Client({host:process.env.POSTGRES_HOST??'localhost',port:Number(process.env.POSTGRES_PORT??5433),
  user:process.env.POSTGRES_USER??'grounded',password:process.env.POSTGRES_PASSWORD,database:process.env.POSTGRES_DB??'grounded_support'});
await client.connect();
try {
  await client.query('BEGIN');
  const schema=`kb_eval_${randomUUID().replaceAll('-','')}`;
  await client.query(`CREATE SCHEMA "${schema}"`);
  await client.query(`SET LOCAL search_path TO "${schema}",public`);
  const directory=new URL('../migrations/',import.meta.url);
  for(const name of (await readdir(directory)).filter(n=>n.endsWith('.sql')).sort()) await client.query((await readFile(new URL(name,directory),'utf8')).split('-- Down Migration')[0]);
  const actor=(await client.query("INSERT INTO admins(email,password_hash,display_name) VALUES('eval@example.invalid','not-a-password','evaluation') RETURNING id::int")).rows[0].id;
  const database={query:(sql,values)=>client.query(sql,values),transaction:async work=>{
    await client.query('SAVEPOINT evaluation_call');
    try {const result=await work(client);await client.query('RELEASE SAVEPOINT evaluation_call');return result;}
    catch(error){await client.query('ROLLBACK TO SAVEPOINT evaluation_call');throw error;}
  }};
  const pool={connect:async()=>({query:(sql,values)=>client.query(sql==='BEGIN'?'SAVEPOINT worker_call':sql==='COMMIT'?'RELEASE SAVEPOINT worker_call':sql==='ROLLBACK'?'ROLLBACK TO SAVEPOINT worker_call':sql,values),release(){}})};
  const runtime={get embedding(){throw new Error('Economy evaluation must not call embeddings');}};
  const bases=new KnowledgeBaseService(database);
  const indexes=new KnowledgeIndexService(database,{enqueueIndex:async()=>{}});
  const faqs=new FaqService(database);
  const search=new VersionSearchService(database,runtime);
  const base=await bases.create(actor,{name:'隔离评测知识库'});
  for(const [i,doc] of fixture.documents.entries()){
    const parsed=await parseDocument(Buffer.from(doc.markdown),`${i}.md`);
    const id=(await client.query(`INSERT INTO documents(knowledge_base_id,title,original_filename,storage_key,sha256,byte_size,uploaded_by,status)
      VALUES($1,$2,$3,$3,$4,$5,$6,'ready') RETURNING id::int`,[base.id,doc.title,`${i}.md`,createHash('sha256').update(doc.markdown).digest('hex'),Buffer.byteLength(doc.markdown),actor])).rows[0].id;
    for(const b of parsed.blocks) await client.query('INSERT INTO document_blocks(document_id,ordinal,block_type,heading_path,content,source_locator) VALUES($1,$2,$3,$4,$5,$6)',[id,b.ordinal,b.blockType,b.headingPath,b.content,b.sourceLocator]);
  }
  for(const faq of fixture.faqs) await faqs.save(actor,base.id,faq);
  const reports=[];
  for(const chunkMode of ['general','parent_child']){
    await indexes.configure(actor,base.id,{chunkMode});
    const version=await indexes.build(actor,base.id);
    await buildKnowledgeIndex(pool,version.id,runtime);
    await indexes.activate(actor,base.id,version.id);
    const cases=[];
    for(const item of fixture.cases){
      const result=await search.search(item.query,5,base.id);
      const actual=[...new Set(result.hits.map(hit=>hit.documentTitle))];
      const expected=item.expectedTitles;
      const rank=result.hits.findIndex(hit=>expected.includes(hit.documentTitle));
      const citationsValid=result.hits.every(hit=>Number.isSafeInteger(hit.chunkId)&&hit.content.length>0&&hit.sourceStartLine>0);
      cases.push({id:item.id,expected,actual,recallAt5:expected.length?expected.filter(t=>actual.includes(t)).length/expected.length:null,
        reciprocalRank:expected.length?(rank<0?0:1/(rank+1)):null,noEvidence:!result.hits.length,citationsValid,
        durationMs:result.durationMs,embeddingCalls:result.embeddingCalls,
        passed:(expected.length?expected.every(t=>actual.includes(t)):!result.hits.length)&&citationsValid});
    }
    const positive=cases.filter(item=>item.recallAt5!==null);
    reports.push({chunkMode,passed:cases.every(item=>item.passed),recallAt5:positive.reduce((s,c)=>s+c.recallAt5,0)/positive.length,
      mrr:positive.reduce((s,c)=>s+c.reciprocalRank,0)/positive.length,cases});
  }
  console.log(JSON.stringify({scope:'real-postgres-retrieval-only',remoteModelCalls:0,
    note:'No-evidence behavior and source IDs are evaluated; actual LLM refusal and semantic citation correctness are not evaluated.',reports},null,2));
  if(reports.some(report=>!report.passed))process.exitCode=1;
} finally {await client.query('ROLLBACK');await client.end();}
