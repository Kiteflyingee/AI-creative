import { DEFAULT_ATTEMPTS, type ProcessorMap } from './bullmq.queue';
import type { EnqueueOptions, JobName, JobPayloads, JobQueue } from './job-queue';

interface QueuedJob {
  name: JobName;
  data: unknown;
  jobId?: string;
  attempt: number;
  maxAttempts: number;
}

/**
 * 进程内顺序执行的任务队列：用于自动化测试与命令行脚本（JOB_QUEUE_MODE=inline），不需要 Redis。
 */
export class InlineJobQueue implements JobQueue {
  readonly jobs: QueuedJob[] = [];
  readonly history: Array<{ name: JobName; data: unknown }> = [];
  processors: ProcessorMap | null = null;

  async enqueue<N extends JobName>(name: N, data: JobPayloads[N], opts: EnqueueOptions = {}) {
    if (opts.jobId && this.jobs.some((j) => j.jobId === opts.jobId)) return;
    this.history.push({ name, data });
    this.jobs.push({ name, data, jobId: opts.jobId, attempt: 1, maxAttempts: opts.attempts ?? DEFAULT_ATTEMPTS[name] ?? 1 });
  }

  /** 顺序执行排队的任务，失败时按次数重试；返回执行的任务数 */
  async drain(opts: { skip?: JobName[]; maxJobs?: number } = {}) {
    if (!this.processors) throw new Error('processors 未设置');
    let count = 0;
    const max = opts.maxJobs ?? 200;
    while (count < max) {
      const index = this.jobs.findIndex((j) => !opts.skip?.includes(j.name));
      if (index < 0) break;
      const job = this.jobs.splice(index, 1)[0]!;
      count++;
      const handler = this.processors[job.name] as (d: unknown, c: { attempt: number; maxAttempts: number }) => Promise<void>;
      try {
        await handler(job.data, { attempt: job.attempt, maxAttempts: job.maxAttempts });
      } catch (err) {
        if (job.attempt < job.maxAttempts) this.jobs.push({ ...job, attempt: job.attempt + 1 });
        else throw err;
      }
    }
    return count;
  }

  /** 丢弃排队中的调度任务（调用方自己按节奏调度） */
  dropTicks() {
    this.jobs.splice(0, this.jobs.length, ...this.jobs.filter((j) => j.name !== 'tick'));
  }

  clear() {
    this.jobs.length = 0;
    this.history.length = 0;
  }
}
