const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;

function readDotEnv() {
  const file = path.resolve(root, '.env');
  if (!fs.existsSync(file)) return {};
  return Object.fromEntries(
    fs
      .readFileSync(file, 'utf8')
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

const dotEnv = readDotEnv();
const databasePort = dotEnv.POSTGRES_PORT || '5433';
const databaseName = dotEnv.POSTGRES_DB || 'grounded_support';
const databaseUser = dotEnv.POSTGRES_USER || 'grounded';
const databasePassword = dotEnv.POSTGRES_PASSWORD || process.env.POSTGRES_PASSWORD || '';
const localData = path.resolve(root, '.data');

if (!fs.existsSync(path.resolve(localData, 'uploads'))) {
  fs.mkdirSync(path.resolve(localData, 'uploads'), { recursive: true });
}

const serverEnv = {
  ...process.env,
  ...dotEnv,
  DATABASE_URL:
    dotEnv.DATABASE_URL ||
    process.env.DATABASE_URL ||
    `postgres://${databaseUser}:${databasePassword}@127.0.0.1:${databasePort}/${databaseName}`,
  PORT: dotEnv.PORT || '3000',
  ALLOWED_ORIGINS:
    dotEnv.ALLOWED_ORIGINS ||
    'http://localhost:8848,http://localhost:3000,http://localhost:8081,http://localhost:8849,http://127.0.0.1:8849,http://localhost:8850,http://127.0.0.1:8850',
  UPLOAD_ROOT: dotEnv.UPLOAD_ROOT || path.resolve(localData, 'uploads'),
  NODE_ENV: 'production',
};

module.exports = {
  apps: [
    {
      name: 'hexu-api',
      cwd: path.resolve(root, 'server'),
      script: 'dist/main.js',
      env: serverEnv,
      autorestart: true,
      max_memory_restart: '350M',
      restart_delay: 2000,
      time: true,
    },
    {
      name: 'hexu-worker',
      cwd: path.resolve(root, 'server'),
      script: 'dist/worker.js',
      env: serverEnv,
      autorestart: true,
      max_memory_restart: '350M',
      restart_delay: 2000,
      time: true,
    },
    {
      name: 'hexu-admin',
      cwd: path.resolve(root, 'web'),
      script: './node_modules/vite/bin/vite.js',
      args: 'preview',
      env: {
        ...process.env,
        ...dotEnv,
        NODE_ENV: 'production',
      },
      autorestart: true,
      max_memory_restart: '200M',
      restart_delay: 2000,
      time: true,
    },
    {
      name: 'hexu-website',
      cwd: path.resolve(root, 'website'),
      script: './node_modules/vite/bin/vite.js',
      args: 'preview',
      env: {
        ...process.env,
        ...dotEnv,
        NODE_ENV: 'production',
      },
      autorestart: true,
      max_memory_restart: '200M',
      restart_delay: 2000,
      time: true,
    },
  ],
};
