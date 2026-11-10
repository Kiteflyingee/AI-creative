import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { getEnv } from './config/env';
import { startWorkers } from './worker';

async function bootstrap() {
  const env = getEnv();
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.useBodyParser('json', { limit: '2mb' });
  // 只允许 H5 页面访问；本机与局域网地址用于真机调试
  app.enableCors({
    origin: [env.H5_ORIGIN, /^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+)(:\d+)?$/],
  });
  app.enableShutdownHooks();
  if (env.WORKER_IN_PROCESS) await startWorkers(app);
  await app.listen(env.PORT, '0.0.0.0');
  Logger.log(
    `服务已启动：http://localhost:${env.PORT}（后台任务${env.WORKER_IN_PROCESS ? '在同一进程运行' : '需单独启动'}）`,
    'Bootstrap',
  );
}

void bootstrap();
