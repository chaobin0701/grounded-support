import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const serverRoot = resolve(root, 'server');
const webRoot = resolve(root, 'web');
const websiteRoot = resolve(root, 'website');
const ecosystemConfig = resolve(root, 'ecosystem.config.cjs');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npxCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx';

function readDotEnv() {
  const file = resolve(root, '.env');
  if (!existsSync(file)) return {};
  return Object.fromEntries(
    readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => {
        const index = line.indexOf('=');
        const key = line.slice(0, index).trim();
        const value = line.slice(index + 1).trim().replace(/^['"]|['"]$/g, '');
        return [key, value];
      })
  );
}

function run(command, args, cwd = root, env = process.env) {
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}`);
  }
}

function checkPort(host, port, timeoutMs = 1500) {
  return new Promise((resolveResult) => {
    const socket = createConnection({ host, port: Number(port) });
    let resolved = false;
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => {
      resolved = true;
      socket.destroy();
      resolveResult(true);
    });
    socket.once('timeout', () => {
      if (!resolved) {
        resolved = true;
        socket.destroy();
        resolveResult(false);
      }
    });
    socket.once('error', () => {
      if (!resolved) {
        resolved = true;
        socket.destroy();
        resolveResult(false);
      }
    });
  });
}

async function ensureDatabase(env) {
  const dbPort = env.POSTGRES_PORT || '5433';
  const isUp = await checkPort('127.0.0.1', dbPort);
  if (isUp) {
    console.log(`[pm2] PostgreSQL is online on port ${dbPort}.`);
    return true;
  }

  console.log(`[pm2] PostgreSQL (port ${dbPort}) is not reachable. Checking Docker...`);
  try {
    const dockerCheck = spawnSync('docker', ['info'], { stdio: 'ignore' });
    if (dockerCheck.status === 0) {
      console.log('[pm2] Starting PostgreSQL container via Docker Compose...');
      run('docker', ['compose', 'up', '-d', 'postgres'], root);
      // Wait for it to become available
      for (let i = 0; i < 10; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        if (await checkPort('127.0.0.1', dbPort)) {
          console.log(`[pm2] PostgreSQL started successfully on port ${dbPort}.`);
          return true;
        }
      }
    }
  } catch {
    // Docker not available or failed
  }

  console.warn(
    `\n⚠️  [提示] 未能连上 PostgreSQL (127.0.0.1:${dbPort})。\n` +
    `   - 如果使用本地 Docker / OrbStack，请先启动 Docker 或执行 docker compose up -d postgres\n` +
    `   - 如果使用远程数据库（如 Supabase / Neon），请在 .env 中配置 DATABASE_URL。\n`
  );
  return false;
}

const action = process.argv[2] || 'start';

async function main() {
  const dotEnv = readDotEnv();

  switch (action) {
    case 'start': {
      console.log('[pm2] 1. Checking database connection...');
      await ensureDatabase(dotEnv);

      console.log('\n[pm2] 2. Building server and running migrations...');
      run(npmCommand, ['run', 'build'], serverRoot);
      try {
        run(npmCommand, ['run', 'db:migrate'], serverRoot);
      } catch (err) {
        console.warn('[pm2] Warning: db:migrate failed, continuing anyway...');
      }

      console.log('\n[pm2] 3. Building frontends (web & website)...');
      run(npmCommand, ['run', 'build'], webRoot);
      run(npmCommand, ['run', 'build'], websiteRoot);

      console.log('\n[pm2] 4. Launching services via PM2...');
      run(npxCommand, ['-y', 'pm2', 'start', ecosystemConfig], root);

      console.log('\n======================================================');
      console.log('🎉 禾序智能客服已在后台稳定常驻运行 (PM2 Process Manager)');
      console.log('======================================================');
      console.log('👉 企业官网:   http://localhost:8849');
      console.log('👉 管理后台:   http://localhost:8848/admin');
      console.log('👉 API 接口:   http://localhost:3000/api/health');
      console.log('------------------------------------------------------');
      console.log('常用管理命令:');
      console.log('  查看状态:   node scripts/pm2-supervisor.mjs status');
      console.log('  查看日志:   node scripts/pm2-supervisor.mjs logs');
      console.log('  重启服务:   node scripts/pm2-supervisor.mjs restart');
      console.log('  停止服务:   node scripts/pm2-supervisor.mjs stop');
      console.log('======================================================\n');
      break;
    }
    case 'stop': {
      run(npxCommand, ['-y', 'pm2', 'stop', ecosystemConfig], root);
      console.log('[pm2] 所有服务已停止。');
      break;
    }
    case 'restart': {
      run(npxCommand, ['-y', 'pm2', 'restart', ecosystemConfig], root);
      console.log('[pm2] 所有服务已重启。');
      break;
    }
    case 'reload': {
      run(npxCommand, ['-y', 'pm2', 'reload', ecosystemConfig], root);
      console.log('[pm2] 所有服务已完成热重载。');
      break;
    }
    case 'status': {
      run(npxCommand, ['-y', 'pm2', 'status'], root);
      break;
    }
    case 'logs': {
      run(npxCommand, ['-y', 'pm2', 'logs'], root);
      break;
    }
    default: {
      console.error(`未知命令: ${action}。支持的命令: start, stop, restart, reload, status, logs`);
      process.exit(1);
    }
  }
}

void main();
