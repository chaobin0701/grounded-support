import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const serverRoot = resolve(root, 'server');
const webRoot = resolve(root, 'web');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const children = new Map();
let stopping = false;

function readDotEnv() {
  const file = resolve(root, '.env');
  if (!existsSync(file)) return {};
  return Object.fromEntries(readFileSync(file, 'utf8').split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && line.includes('='))
    .map((line) => {
      const index = line.indexOf('=');
      const key = line.slice(0, index).trim();
      const value = line.slice(index + 1).trim().replace(/^['"]|['"]$/gu, '');
      return [key, value];
    }));
}

function run(command, args, cwd, env) {
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}`);
}

function start(name, args, cwd, env) {
  if (stopping) return;
  const child = spawn(npmCommand, args, { cwd, env, stdio: 'inherit' });
  children.set(name, child);
  console.log(`[dev] ${name} started (pid ${child.pid})`);
  child.once('exit', (code, signal) => {
    children.delete(name);
    if (stopping) return;
    console.warn(`[dev] ${name} stopped (${signal ?? `exit ${code}`}), restarting in 1s…`);
    setTimeout(() => start(name, args, cwd, env), 1000);
  });
  child.once('error', (error) => console.error(`[dev] ${name} error: ${error.message}`));
}

async function checkApi() {
  try {
    const response = await fetch('http://127.0.0.1:3000/api/health');
    if (response.ok) {
      console.log('[dev] API online · http://localhost:3000/api/health');
      return true;
    }
  } catch { /* The restart loop will keep the process available. */ }
  console.warn('[dev] API is not ready yet; inspect the API terminal if this persists.');
  return false;
}

const dotEnv = readDotEnv();
const databasePort = dotEnv.POSTGRES_PORT || '5433';
const databaseName = dotEnv.POSTGRES_DB || 'grounded_support';
const databaseUser = dotEnv.POSTGRES_USER || 'grounded';
const databasePassword = dotEnv.POSTGRES_PASSWORD || 'grounded-local-only-2026';
const localData = resolve(root, '.data');
mkdirSync(resolve(localData, 'uploads'), { recursive: true });
const serverEnv = {
  ...process.env,
  ...dotEnv,
  DATABASE_URL: `postgres://${databaseUser}:${databasePassword}@127.0.0.1:${databasePort}/${databaseName}`,
  PORT: '3000',
  ALLOWED_ORIGINS: 'http://localhost:8848,http://localhost:3000,http://localhost:8081',
  UPLOAD_ROOT: resolve(localData, 'uploads'),
};
const webEnv = { ...process.env, ...dotEnv };

console.log('[dev] starting database container only…');
run('docker', ['compose', 'up', '-d', 'postgres'], root, serverEnv);
run('docker', ['compose', 'stop', 'api', 'worker', 'web'], root, serverEnv);
console.log('[dev] building server once before watch mode…');
run(npmCommand, ['run', 'build'], serverRoot, serverEnv);
run(npmCommand, ['run', 'db:migrate'], serverRoot, serverEnv);

start('server-build', ['run', 'dev:watch'], serverRoot, serverEnv);
start('api', ['run', 'dev:api'], serverRoot, serverEnv);
start('worker', ['run', 'dev:worker'], serverRoot, serverEnv);
start('web', ['run', 'dev'], webRoot, webEnv);

setTimeout(() => { void checkApi(); }, 1500);
const healthTimer = setInterval(() => { void checkApi(); }, 10_000);
console.log('[dev] hot reload ready · http://localhost:8848');
console.log('[dev] edit web/src or server/src; the supervisor keeps API/Web/Worker online.');

function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  clearInterval(healthTimer);
  console.log(`\n[dev] ${signal} received; stopping development processes…`);
  for (const child of children.values()) child.kill('SIGTERM');
  setTimeout(() => process.exit(0), 500);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
