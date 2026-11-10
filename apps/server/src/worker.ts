import 'reflect-metadata';
import { Logger, type INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { getEnv } from './config/env';
import { BullJobQueue, BullWorkers } from './queue/bullmq.queue';
import { JOB_QUEUE } from './queue/job-queue';
import { buildProcessors } from './queue/processors';

export async function startWorkers(app: INestApplicationContext) {
  const workers = new BullWorkers();
  workers.start(buildProcessors(app));
  const queue = app.get<BullJobQueue>(JOB_QUEUE);
  await queue.scheduleTick(getEnv().VIDEO_POLL_INTERVAL_MS);
  const shutdown = async () => {
    await workers.close();
    await queue.close();
  };
  process.once('SIGTERM', () => void shutdown());
  process.once('SIGINT', () => void shutdown());
}

/** 单独的后台进程（生产部署用）：node dist/worker.js */
async function main() {
  const app = await NestFactory.createApplicationContext(AppModule);
  await startWorkers(app);
  Logger.log('后台任务进程已启动', 'Worker');
}

if (require.main === module) void main();
