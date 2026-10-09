// Update only the restored internal app, leaving external apps and API keys intact.
const {Pool}=require('pg');
const pool=new Pool({connectionString:process.env.DATABASE_URL});
(async()=>{
  const origins=process.env.ALLOWED_ORIGINS.split(',');
  if(origins.length!==2||origins.some(o=>new URL(o).protocol!=='https:'))throw Error('Expected two HTTPS origins');
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const app=(await client.query('SELECT id,allowed_origins FROM integration_apps WHERE is_internal FOR UPDATE')).rows;
    if(app.length!==1)throw Error('Expected exactly one internal app');
    const actor=(await client.query(`SELECT a.id::int FROM admins a JOIN admin_roles ar ON ar.admin_id=a.id
      JOIN roles r ON r.id=ar.role_id WHERE a.disabled_at IS NULL AND r.code='super_admin' ORDER BY a.id LIMIT 1`)).rows[0];
    if(!actor)throw Error('An active super administrator is required');
    if(JSON.stringify(app[0].allowed_origins)!==JSON.stringify(origins)) {
      await client.query('UPDATE integration_apps SET allowed_origins=$2,auth_version=auth_version+1,updated_at=now() WHERE id=$1',[app[0].id,origins]);
      await client.query(`INSERT INTO audit_logs(actor_admin_id,action,target_type,target_id,details) VALUES($1,'integration.deployment_origins','integration',$2,$3)`,
        [actor.id,app[0].id,JSON.stringify({previousOrigins:app[0].allowed_origins,allowedOrigins:origins,reason:'Initial production migration',performedBy:'authorized SSH deployment'})]);
    }
    await client.query('COMMIT');
    console.log(JSON.stringify({productionOrigins:origins,externalAppsUnchanged:true,apiKeysUnchanged:true}));
  }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
})().catch(error=>{console.error(JSON.stringify({error:'production_origin_setup_failed',reason:error.code??error.name}));process.exitCode=1;}).finally(()=>pool.end());
