import type { INestApplicationContext } from '@nestjs/common';
import { sleep } from '../common/util';
import { getEnv } from '../config/env';
import { GenerationService } from '../generation/generation.service';
import { PrismaService } from '../prisma/prisma.service';
import { InlineJobQueue } from '../queue/inline.queue';
import { JOB_QUEUE } from '../queue/job-queue';
import { buildProcessors } from '../queue/processors';

/** 命令行脚本里在当前进程执行后台任务（JOB_QUEUE_MODE=inline） */
export class InlineRunner {
  private app: INestApplicationContext | null = null;

  constructor() {
    process.env.JOB_QUEUE_MODE = 'inline';
    process.env.WORKER_IN_PROCESS = 'false';
  }

  attach(app: INestApplicationContext) {
    this.app = app;
    this.queue.processors = buildProcessors(app);
  }

  get queue(): InlineJobQueue {
    if (!this.app) throw new Error('还没有 attach');
    return this.app.get<InlineJobQueue>(JOB_QUEUE);
  }

  async drain() {
    await this.queue.drain({ skip: ['tick'] });
    this.queue.dropTicks();
  }

  /** 按轮询间隔推进任务，直到结束 */
  async runJob(jobId: string, maxMinutes = 40) {
    const app = this.app!;
    const generation = app.get(GenerationService);
    const prisma = app.get(PrismaService);
    const deadline = Date.now() + maxMinutes * 60_000;
    while (Date.now() < deadline) {
      await this.drain();
      await generation.tick();
      await this.drain();
      const job = await prisma.generationJob.findUniqueOrThrow({ where: { id: jobId } });
      console.log(`任务 ${jobId}：${job.status}`);
      if (['COMPLETED', 'FAILED', 'PARTIAL_FAILED', 'CANCELLED'].includes(job.status)) return job;
      await sleep(getEnv().VIDEO_POLL_INTERVAL_MS);
    }
    throw new Error('等待超时');
  }
}
