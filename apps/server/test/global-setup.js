// 测试开始前把迁移应用到测试数据库
const { execFileSync } = require('node:child_process');
const { resolve } = require('node:path');

module.exports = async () => {
  execFileSync('node', [resolve(__dirname, '..', 'scripts', 'prisma.js'), 'migrate', 'deploy'], {
    stdio: 'pipe',
    env: {
      ...process.env,
      PRISMA_DATABASE_URL: 'postgresql://aicreative:aicreative@localhost:5432/aicreative_test',
      PRISMA_HIDE_UPDATE_MESSAGE: '1',
    },
  });
};
