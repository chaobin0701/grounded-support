import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=path=>readFileSync(new URL(`../../${path}`,import.meta.url),'utf8');
test('production exposes only ingress, bounds resources and separates credential configuration from images',()=>{
  const compose=source('compose.production.yml');
  assert.equal((compose.match(/\n\s+ports:/g)||[]).length,1);
  assert.match(compose,/EDGE_BIND_IP:-127\.0\.0\.1/);
  assert.match(compose,/mem_limit: 256m/);
  assert.match(compose,/env_file:/);
  assert.match(compose,/restart: unless-stopped/);
  assert.doesNotMatch(source('deploy/edge.Dockerfile'),/COPY.*\.env/);
  assert.match(source('deploy/edge.Dockerfile.dockerignore'),/^\*\*/);
});
test('both virtual hosts keep API routes, stream flushing and SPA history fallback',()=>{
  const edge=source('deploy/Caddyfile');
  assert.equal((edge.match(/import application_api/g)||[]).length,2);
  assert.equal((edge.match(/try_files \{path\} \/index.html/g)||[]).length,2);
  assert.match(edge,/flush_interval -1/);
  assert.match(edge,/reverse_proxy api:3000/);
});
test('migration exports only private artifacts, checks original bytes, preserves effective encryption and resumes local services',()=>{
  const exportScript=source('server/scripts/prepare-production-migration.mjs');
  assert.match(exportScript,/mode:0o600/);
  assert.match(exportScript,/MODEL_CONFIG_ENCRYPTION_KEY \|\| process.env.JWT_SECRET/);
  assert.match(exportScript,/resumed.reverse\(\)/);
  assert.match(exportScript,/SIGCONT/);
  assert.match(exportScript,/File integrity mismatch/);
  assert.match(exportScript,/--no-owner/);
  assert.match(source('deploy/verify-migration.cjs'),/secrets.decrypt/);
});
test('scheduled backup resumes services even on failure and never prunes user data',()=>{
  const backup=source('deploy/backup.sh');
  assert.match(backup,/trap .*compose start api worker edge/);
  assert.match(backup,/flock -n/);
  assert.doesNotMatch(backup,/docker.*prune|rm -r|down.*-v/);
  assert.match(source('deploy/hexu-backup.timer'),/Asia\/Shanghai/);
});
