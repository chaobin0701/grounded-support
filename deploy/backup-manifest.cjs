const {Pool}=require('pg');
const pool=new Pool({connectionString:process.env.DATABASE_URL});
(async()=>{
  const tables=(await pool.query("SELECT schemaname,tablename FROM pg_tables WHERE schemaname IN ('public','pgboss') ORDER BY schemaname,tablename")).rows;
  const counts={};
  for(const {schemaname,tablename} of tables) {
    const identifier=value=>`"${value.replaceAll('"','""')}"`;
    counts[`${schemaname}.${tablename}`]=(await pool.query(`SELECT count(*)::text AS count FROM ${identifier(schemaname)}.${identifier(tablename)}`)).rows[0].count;
  }
  const documents=(await pool.query("SELECT id::int,storage_key,sha256,byte_size::int FROM documents WHERE source_type='file' ORDER BY id")).rows;
  const versions=(await pool.query("SELECT current_setting('server_version') AS postgres,(SELECT extversion FROM pg_extension WHERE extname='vector') AS vector")).rows[0];
  console.log(JSON.stringify({version:1,createdAt:new Date().toISOString(),versions,counts,documents},null,2));
})().catch(()=>{console.error('Backup manifest failed');process.exitCode=1;}).finally(()=>pool.end());
