// Generates private migration artifacts only beneath ignored .data/migrations.
// Never prints credentials or document contents. Run with --env-file=../.env.
import { randomBytes, createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile, chmod, stat } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import pg from 'pg';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const release = process.env.DEPLOY_RELEASE;
if (!release || !/^[a-zA-Z0-9._-]+$/.test(release)) throw Error('Set a safe DEPLOY_RELEASE tag');
const pool = new pg.Pool({ host: '127.0.0.1', port: Number(process.env.POSTGRES_PORT || 5433),
  user: process.env.POSTGRES_USER, password: process.env.POSTGRES_PASSWORD,
  database: process.env.POSTGRES_DB || 'grounded_support', connectionTimeoutMillis: 5000 });
const privateRoot = join(root, '.data/migrations');
await mkdir(privateRoot, { recursive: true, mode: 0o700 });
const destination = await mkdtemp(join(privateRoot, `${release}-`));
await chmod(destination, 0o700);
const resumed = [];
const quoteIdentifier = value => `"${value.replaceAll('"', '""')}"`;
const quoteEnv = value => {
  if (/[\r\n]/.test(value)) throw Error('Multiline environment values are unsupported');
  return `'${value.replaceAll("'", "\\'")}'`;
};
try {
  const busy = (await pool.query(`SELECT
    (SELECT count(*) FROM conversation_runs WHERE status IN ('queued','running') AND expires_at>now())::int AS chats,
    (SELECT count(*) FROM documents WHERE status='processing')::int AS documents,
    (SELECT count(*) FROM knowledge_index_versions WHERE status='building')::int AS indexes`)).rows[0];
  if (Object.values(busy).some(Boolean)) throw Error('Active work exists; wait for it to finish before migration');

  // Optional bounded snapshot pause: keep the database running and always resume processes.
  const supervisorPid = Number(process.env.PAUSE_DEV_SUPERVISOR_PID || 0);
  if (supervisorPid) {
    const lines = execFileSync('ps', ['-ax', '-o', 'pid=,ppid=,command='], { encoding: 'utf8' }).split('\n');
    const supervisor = lines.find(line => new RegExp(`^\\s*${supervisorPid}\\s`).test(line));
    if (!supervisor?.includes('scripts/dev-supervisor.mjs')) throw Error('Supervisor identity mismatch');
    const groups = lines.flatMap(line => {
      const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/);
      return match && Number(match[2]) === supervisorPid && /npm run dev:(api|worker)\s*$/.test(match[3]) ? [Number(match[1])] : [];
    });
    if (groups.length !== 2) throw Error('Expected exactly the API and Worker process groups');
    process.kill(supervisorPid, 'SIGSTOP'); resumed.push(supervisorPid);
    for (const pid of groups) { process.kill(-pid, 'SIGSTOP'); resumed.push(-pid); }
  }

  const tables = (await pool.query(`SELECT schemaname,tablename FROM pg_tables WHERE schemaname IN ('public','pgboss') ORDER BY schemaname,tablename`)).rows;
  const counts = {};
  for (const {schemaname,tablename} of tables) {
    counts[`${schemaname}.${tablename}`] = (await pool.query(`SELECT count(*)::text AS count FROM ${quoteIdentifier(schemaname)}.${quoteIdentifier(tablename)}`)).rows[0].count;
  }
  const versions = (await pool.query("SELECT current_setting('server_version') AS postgres,(SELECT extversion FROM pg_extension WHERE extname='vector') AS vector")).rows[0];
  const docs = (await pool.query("SELECT id::int,storage_key,sha256,byte_size::int FROM documents WHERE source_type='file' ORDER BY id")).rows;
  const containerId = execFileSync('docker', ['compose', 'ps', '-q', 'postgres'], {cwd:root,encoding:'utf8'}).trim();
  if (!/^[a-f0-9]{12,64}$/.test(containerId)) throw Error('Local PostgreSQL container is not running');
  const dumpPath = join(destination, 'database.dump');
  const dump = spawn('docker', ['exec', containerId, 'pg_dump', '-U', process.env.POSTGRES_USER || 'grounded',
    '-d', process.env.POSTGRES_DB || 'grounded_support', '-Fc', '--no-owner', '--no-acl'], {stdio:['ignore','pipe','pipe']});
  let dumpError = ''; dump.stderr.on('data', b => {dumpError += b.toString();});
  const finished = new Promise((resolveExit,reject) => {dump.on('error',reject);dump.on('close',code=>code===0?resolveExit():reject(Error(`Database export failed (${code})`)));});
  await Promise.all([pipeline(dump.stdout,createWriteStream(dumpPath,{flags:'wx',mode:0o600})),finished]);
  if (dumpError.trim()) throw Error('Database export produced warnings; inspect privately before proceeding');

  const oldUploads = join(destination,'old-uploads');
  await mkdir(oldUploads,{mode:0o700});
  execFileSync('docker',['run','--rm','--pull=never','--network','none','--read-only',
    '--mount','type=volume,src=grounded-support_uploads,dst=/uploads,readonly',
    '--mount',`type=bind,src=${oldUploads},dst=/destination`,'--entrypoint','cp','pgvector/pgvector:pg17','-a','/uploads/.','/destination/'],{stdio:'pipe'});
  const outputDocs = join(destination,'uploads/documents');
  await mkdir(outputDocs,{recursive:true,mode:0o700});
  const sources = {local:0,oldDocker:0};
  for (const doc of docs) {
    if (!/^[a-zA-Z0-9._-]+$/.test(doc.storage_key)) throw Error(`Invalid storage key for document ${doc.id}`);
    const paths = [[join(root,'.data/uploads/documents',doc.storage_key),'local'],[join(oldUploads,'documents',doc.storage_key),'oldDocker']];
    const found = [];
    for (const [path,source] of paths) {
      let bytes; try {bytes=await readFile(path);} catch (e) {if(e.code==='ENOENT')continue;throw e;}
      if(bytes.length!==doc.byte_size || createHash('sha256').update(bytes).digest('hex')!==doc.sha256) throw Error(`File integrity mismatch for document ${doc.id}`);
      found.push({bytes,source});
    }
    if(!found.length)throw Error(`Missing source file for document ${doc.id}`);
    sources[found[0].source]++;
    await writeFile(join(outputDocs,doc.storage_key),found[0].bytes,{flag:'wx',mode:0o600});
  }
  const password = randomBytes(32).toString('hex');
  const originalEncryptionSource = process.env.MODEL_CONFIG_ENCRYPTION_KEY || process.env.JWT_SECRET;
  if(!originalEncryptionSource)throw Error('Missing original encryption source');
  const environment = {
    SERVER_IMAGE:`hexu-server:${release}`,EDGE_IMAGE:`hexu-edge:${release}`,POSTGRES_IMAGE:'pgvector/pgvector:pg17',
    POSTGRES_DB:'grounded_support',POSTGRES_USER:'hexu',POSTGRES_PASSWORD:password,
    DATABASE_URL:`postgres://hexu:${password}@postgres:5432/grounded_support`,
    JWT_SECRET:randomBytes(48).toString('hex'),MODEL_CONFIG_ENCRYPTION_KEY:originalEncryptionSource,
    WEBSITE_DOMAIN:'hexu.7410000.xyz',ADMIN_DOMAIN:'hexu-admin.7410000.xyz',EDGE_BIND_IP:'127.0.0.1',
    NODE_ENV:'production',UPLOAD_ROOT:'/data/uploads',PORT:'3000',TRUST_PROXY:'1',
    ALLOWED_ORIGINS:'https://hexu.7410000.xyz,https://hexu-admin.7410000.xyz',
    CHAT_CONCURRENCY:'2',DOCUMENT_UPLOAD_CONCURRENCY:'1',DOCUMENT_UPLOAD_RATE_LIMIT:'20',
  };
  for(const name of ['JWT_ISSUER','JWT_AUDIENCE','JWT_EXPIRES_IN_SECONDS','LLM_PROVIDER','LLM_API_KEY','LLM_BASE_URL','LLM_MODEL',
    'LLM_TIMEOUT_MS','LLM_CONTEXT_WINDOW_TOKENS','LLM_MAX_OUTPUT_TOKENS','LLM_ALLOWED_BASE_URLS',
    'EMBEDDING_API_KEY','EMBEDDING_BASE_URL','EMBEDDING_MODEL','EMBEDDING_ALLOWED_BASE_URLS','EMBEDDING_CONNECTIONS_JSON']) {
    if(process.env[name])environment[name]=process.env[name];
  }
  await writeFile(join(destination,'.env.production'),Object.entries(environment).map(([k,v])=>`${k}=${quoteEnv(v)}`).join('\n')+'\n',{flag:'wx',mode:0o600});
  const manifest = {version:1,createdAt:new Date().toISOString(),release,versions,counts,documents:docs,sources,
    databaseSha256:createHash('sha256').update(await readFile(dumpPath)).digest('hex')};
  await writeFile(join(destination,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o600});
  console.log(JSON.stringify({artifactDirectory:destination,databaseBytes:(await stat(dumpPath)).size,files:docs.length,sources,versions,tableCount:tables.length}));
} finally {
  for(const pid of resumed.reverse()) {try{process.kill(pid,'SIGCONT');}catch{ /* Preserve original failure without exposing secrets. */ }}
  await pool.end();
}
