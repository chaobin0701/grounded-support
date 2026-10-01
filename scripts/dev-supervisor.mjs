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
const healthState = new Map();

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
  const child = spawn(npmCommand, args, {
    cwd,
    env,
    stdio: 'inherit',
    detached: process.platform !== 'win32',
  });
  const entry = { child, args, cwd, env, stopping: false };
  children.set(name, entry);
  console.log(`[dev] ${name} started (pid ${child.pid})`);
  child.once('exit', (code, signal) => {
    if (children.get(name) !== entry) return;
    children.delete(name);
    if (stopping || entry.stopping) return;
    console.warn(`[dev] ${name} stopped (${signal ?? `exit ${code}`}), restarting in 1s…`);
    setTimeout(() => start(name, args, cwd, env), 1000);
  });
  child.once('error', (error) => console.error(`[dev] ${name} error: ${error.message}`));
}

function stop(name) {
  const entry = children.get(name);
  if (!entry) return;
  entry.stopping = true;
  children.delete(name);
  try {
    if (process.platform !== 'win32' && entry.child.pid) process.kill(-entry.child.pid, 'SIGTERM');
    else entry.child.kill('SIGTERM');
  } catch { /* The process may have already exited. */ }
}

function restart(name) {
  const entry = children.get(name);
  if (!entry) return;
  const { args, cwd, env } = entry;
  console.warn(`[dev] ${name} is unhealthy; restarting it…`);
  stop(name);
  setTimeout(() => start(name, args, cwd, env), 250);
}

async function checkService(name, url) {
  const state = healthState.get(name) ?? { failures: 0, online: false };
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
    if (response.ok) {
      if (!state.online) console.log(`[dev] ${name} online · ${url}`);
      state.online = true;
      state.failures = 0;
      healthState.set(name, state);
      return true;
    }
  } catch { /* The restart threshold below handles transient startup failures. */ }
  state.online = false;
  state.failures += 1;
  healthState.set(name, state);
  console.warn(`[dev] ${name} is not ready (${state.failures}/3); inspect the terminal if this persists.`);
  if (state.failures >= 3) {
    state.failures = 0;
    healthState.set(name, state);
    restart(name);
  }
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

setTimeout(() => {
  void checkService('api', 'http://127.0.0.1:3000/api/health');
  void checkService('web', 'http://127.0.0.1:8848/');
}, 1500);
const healthTimer = setInterval(() => {
  void checkService('api', 'http://127.0.0.1:3000/api/health');
  void checkService('web', 'http://127.0.0.1:8848/');
}, 10_000);
console.log('[dev] hot reload ready · http://localhost:8848');
console.log('[dev] edit web/src or server/src; the supervisor keeps API/Web/Worker online.');

function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  clearInterval(healthTimer);
  console.log(`\n[dev] ${signal} received; stopping development processes…`);
  for (const name of children.keys()) stop(name);
  setTimeout(() => process.exit(0), 1000);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
