// 读取仓库根目录的 .env 后调用 prisma CLI（Prisma 默认只读取 apps/server 下的 .env）
const { spawnSync } = require('node:child_process');
const { existsSync } = require('node:fs');
const { resolve } = require('node:path');

const envFile = resolve(__dirname, '..', '..', '..', '.env');
if (existsSync(envFile)) require('dotenv').config({ path: envFile, quiet: true });
if (process.env.PRISMA_DATABASE_URL) process.env.DATABASE_URL = process.env.PRISMA_DATABASE_URL;

const result = spawnSync('npx', ['prisma', ...process.argv.slice(2)], {
  stdio: 'inherit',
  cwd: resolve(__dirname, '..'),
  env: process.env,
});
process.exit(result.status ?? 1);
