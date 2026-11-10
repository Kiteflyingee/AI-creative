import { defineConfig, devices } from '@playwright/test';

/**
 * H5 端到端测试：手机尺寸，后端使用测试代码里的假模型供应商（不产生费用）+ 真实 Remotion 合成。
 * 运行：npm run e2e -w @ai-creative/h5（需要先 docker compose up -d）
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 8 * 60_000,
  expect: { timeout: 30_000 },
  workers: 1,
  reporter: [['list']],
  use: {
    ...devices['iPhone 13'],
    browserName: 'chromium',
    baseURL: 'http://localhost:5174',
    trace: 'retain-on-failure',
    actionTimeout: 30_000,
  },
  webServer: [
    {
      command: 'node -r ts-node/register/transpile-only test/e2e-server.ts',
      cwd: '../server',
      url: 'http://localhost:3101/app/v1/me',
      timeout: 120_000,
      reuseExistingServer: false,
      stdout: 'pipe',
    },
    {
      command: 'npx vite --port 5174 --strictPort',
      cwd: '.',
      url: 'http://localhost:5174',
      env: { VITE_API_BASE: 'http://localhost:3101' },
      timeout: 120_000,
      reuseExistingServer: false,
    },
  ],
});
