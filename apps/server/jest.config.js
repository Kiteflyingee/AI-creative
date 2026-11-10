/** @type {import('jest').Config} */
module.exports = {
  rootDir: '.',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/test/**/*.test.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.jest.json' }],
  },
  setupFiles: ['<rootDir>/test/setup-env.ts'],
  globalSetup: '<rootDir>/test/global-setup.js',
  testTimeout: 60000,
  // Remotion 渲染测试较慢，单独运行：npm run test:render
  testPathIgnorePatterns: process.env.RUN_RENDER_TEST ? [] : ['render\\.int\\.test\\.ts$'],
};
