import { Logger } from '@nestjs/common';
import { Queue, Worker, type ConnectionOptions } from 'bullmq';
import { getEnv } from '../config/env';
import { errorMessage } from '../common/util';
import type { EnqueueOptions, JobContext, JobName, JobPayloads, JobQueue } from './job-queue';

const PREFIX = 'aic';

export const QUEUE_CONCURRENCY: Record<JobName, number> = {
  tick: 1,
  transfer: 2,
  compose: 1,
  qc: 2,
  image: 3,
  inspect: 3,
};

export const DEFAULT_ATTEMPTS: Partial<Record<JobName, number>> = {
  transfer: 5,
  compose: 2,
  image: 3,
  inspect: 2,
  qc: 1,
};

function connection(): ConnectionOptions {
  const url = new URL(getEnv().REDIS_URL);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    password: url.password || undefined,
    db: url.pathname && url.pathname !== '/' ? Number(url.pathname.slice(1)) : 0,
    maxRetriesPerRequest: null,
  };
}

export class BullJobQueue implements JobQueue {
  private readonly queues = new Map<JobName, Queue>();

  private queue(name: JobName): Queue {
    let q = this.queues.get(name);
    if (!q) {
      q = new Queue(name, { connection: connection(), prefix: PREFIX });
      this.queues.set(name, q);
    }
    return q;
  }

  async enqueue<N extends JobName>(name: N, data: JobPayloads[N], opts: EnqueueOptions = {}): Promise<void> {
    await this.queue(name).add(name, data, {
      delay: opts.delayMs,
      jobId: opts.jobId,
      attempts: opts.attempts ?? DEFAULT_ATTEMPTS[name] ?? 1,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: { count: 200 },
      removeOnFail: { count: 500 },
    });
  }

  /** 定时调度（轮询视频任务） */
  async scheduleTick(everyMs: number) {
    await this.queue('tick').upsertJobScheduler('tick-scheduler', { every: everyMs }, { name: 'tick', data: {} });
  }

  async close() {
    await Promise.all([...this.queues.values()].map((q) => q.close()));
  }
}

export type Processor<N extends JobName> = (data: JobPayloads[N], ctx: JobContext) => Promise<void>;
export type ProcessorMap = { [N in JobName]: Processor<N> };

/** 后台进程：为每个队列启动 Worker */
export class BullWorkers {
  private readonly logger = new Logger('Workers');
  private readonly workers: Worker[] = [];

  start(processors: ProcessorMap) {
    for (const name of Object.keys(processors) as JobName[]) {
      const handler = processors[name] as Processor<JobName>;
      const worker = new Worker(
        name,
        async (job) => {
          const ctx: JobContext = { attempt: job.attemptsMade + 1, maxAttempts: job.opts.attempts ?? 1 };
          await handler(job.data as JobPayloads[JobName], ctx);
        },
        { connection: connection(), prefix: PREFIX, concurrency: QUEUE_CONCURRENCY[name] },
      );
      worker.on('failed', (job, err) => {
        this.logger.warn(`任务 ${name}#${job?.id} 失败（第 ${job?.attemptsMade} 次）：${errorMessage(err)}`);
      });
      this.workers.push(worker);
    }
    this.logger.log(`后台任务已启动：${Object.keys(processors).join(', ')}`);
  }

  async close() {
    await Promise.all(this.workers.map((w) => w.close()));
  }
}
