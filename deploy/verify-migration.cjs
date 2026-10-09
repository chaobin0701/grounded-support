// Run in the application image with the manifest mounted read-only.
const {Pool} = require('pg');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const {createHash} = require('node:crypto');
const {AppConfigService} = require('./dist/config/config.service.js');
const {SecretBox} = require('./dist/security/secret-box.js');
const manifest=JSON.parse(readFileSync('/app/migration-manifest.json','utf8'));
const databaseUrl=new URL(process.env.DATABASE_URL);
if(process.env.VERIFY_DATABASE) {
  if(!/^hexu_restore_check_[0-9]{8}$/.test(process.env.VERIFY_DATABASE))throw Error('Invalid restore verification database');
  databaseUrl.pathname='/'+process.env.VERIFY_DATABASE;
}
const pool=new Pool({connectionString:databaseUrl.toString()});
(async()=>{
  let tables=0;
  for(const [name,expected] of Object.entries(manifest.counts)) {
    const parts=name.split('.');
    if(parts.length!==2||parts.some(p=>!/^[a-zA-Z0-9_]+$/.test(p)))throw Error('Invalid manifest table');
    const actual=(await pool.query(`SELECT count(*)::text AS count FROM "${parts[0]}"."${parts[1]}"`)).rows[0].count;
    if(actual!==expected)throw Error(`Row count mismatch: ${name}`);
    tables++;
  }
  for(const doc of manifest.documents) {
    if(!/^[a-zA-Z0-9._-]+$/.test(doc.storage_key))throw Error('Invalid manifest storage key');
    const bytes=readFileSync(join(process.env.UPLOAD_ROOT,'documents',doc.storage_key));
    if(bytes.length!==doc.byte_size||createHash('sha256').update(bytes).digest('hex')!==doc.sha256)throw Error(`File mismatch: document ${doc.id}`);
  }
  const secrets=new SecretBox(new AppConfigService());
  let profiles=0;
  for(const table of ['llm_profiles','embedding_profiles']) {
    for(const row of (await pool.query(`SELECT api_key_ciphertext FROM ${table}`)).rows) {
      if(row.api_key_ciphertext) {if(!secrets.decrypt(row.api_key_ciphertext))throw Error('Empty decrypted model credential');profiles++;}
    }
  }
  const versions=(await pool.query("SELECT current_setting('server_version') AS postgres,(SELECT extversion FROM pg_extension WHERE extname='vector') AS vector")).rows[0];
  const original=manifest.versions.vector.split('.').map(Number),current=versions.vector.split('.').map(Number);
  if(current[0]!==original[0]||current[1]!==original[1]||current[2]<original[2])throw Error('Vector extension version mismatch');
  if(versions.postgres.split('.')[0]!==manifest.versions.postgres.split('.')[0])throw Error('PostgreSQL major version mismatch');
  console.log(JSON.stringify({verifiedTables:tables,verifiedFiles:manifest.documents.length,decryptableProfiles:profiles,versions,originalVectorVersion:manifest.versions.vector}));
})().catch(error=>{
  const safe=/^(Row count mismatch:|File mismatch:|Vector extension version mismatch|Invalid manifest|Empty decrypted)/.test(error.message)?error.message:undefined;
  console.error(JSON.stringify({error:'migration_verification_failed',reason:safe??error.code??error.name}));
  process.exitCode=1;
}).finally(()=>pool.end());
