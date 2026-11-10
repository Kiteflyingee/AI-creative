import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { frameSize, OUTPUT_FPS, type Resolution } from '@ai-creative/shared';
import { Prisma, type Clip, type ClipStatus, type GenerationJob } from '@prisma/client';
import { AssetsService } from '../assets/assets.service';
import { badRequest, conflict, notFound, ProviderError } from '../common/errors';
import { errorMessage, jsonSafe, sleep } from '../common/util';
import { getEnv, repoPath } from '../config/env';
import { shotSpecHash, StoryboardService } from '../creative/storyboard.service';
import { normalizeClip, probe } from '../media/ffmpeg';
import { PrismaService } from '../prisma/prisma.service';
import { httpDownload } from '../providers/http';
import {
  VIDEO_PROVIDER,
  type CompiledVideoRequest,
  type ImageInput,
  type ImageSourceRef,
  type ShotRenderSpec,
  type VideoProvider,
} from '../providers/types';
import { JOB_QUEUE, type JobContext, type JobQueue } from '../queue/job-queue';
import { StorageService } from '../storage/storage.service';
import { OutputsService } from './outputs.service';

const TERMINAL: ClipStatus[] = ['SUCCEEDED', 'FAILED', 'CANCELLED'];
const IN_FLIGHT: ClipStatus[] = ['SUBMITTING', 'SUBMITTED', 'RUNNING'];
const MAX_SUBMIT_ATTEMPTS = 5;
/** 提交中途进程退出，无法确认供应商是否已创建任务：超过这个时间标为失败，避免重复提交产生重复费用 */
const SUBMITTING_STALE_MS = 5 * 60_000;

export interface ClipRequest {
  spec: ShotRenderSpec;
  compiled: CompiledVideoRequest;
}

/** 供应商常见错误转成商家能看懂的说明 */
export function friendlyProviderError(code: string, message: string): string {
  const text = `${code} ${message}`;
  if (/face|人脸|portrait|肖像/i.test(text)) return '参考图中可能含有真人人脸，视频模型拒绝了这张图。请把人物图换成虚拟人像、AI 相似人物，或不用这张图后重试';
  if (/sensitive|审核|risk|policy|inappropriate|违规/i.test(text)) return '内容未通过视频模型的安全审核，请修改画面描述或参考图后重试';
  if (/TaskTypeMismatch|TaskTypeConstraint/i.test(text)) return '视频模型判断的任务类型与参数不一致，请修改镜头描述后重试';
  return `视频生成失败：${message}`;
}

@Injectable()
export class GenerationService {
  private readonly logger = new Logger(GenerationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storyboards: StoryboardService,
    private readonly assets: AssetsService,
    private readonly storage: StorageService,
    private readonly outputs: OutputsService,
    @Inject(VIDEO_PROVIDER) private readonly video: VideoProvider,
    @Inject(JOB_QUEUE) private readonly queue: JobQueue,
  ) {}

  /**
   * 商家在生成确认页确认后创建任务（D-41）：一个镜头一个片段，片段版本只增不改。
   * 同一个幂等键只创建一次任务。
   */
  async create(
    userId: string,
    projectId: string,
    input: { resolution: Resolution; shotIds?: string[]; idempotencyKey: string; storyboardVersion?: number },
  ) {
    const existing = await this.prisma.generationJob.findUnique({
      where: { userId_idempotencyKey: { userId, idempotencyKey: input.idempotencyKey } },
    });
    if (existing) {
      if (existing.projectId !== projectId) throw conflict('IDEMPOTENCY_REUSED', '幂等键已用于其他项目');
      return this.jobView(existing.id);
    }

    const { row, spec } = await this.storyboards.requireLatest(userId, projectId);
    if (input.storyboardVersion !== undefined && input.storyboardVersion !== row.version) {
      throw conflict('STORYBOARD_CHANGED', '故事板已经更新，请返回确认页重新确认');
    }
    const cap = this.video.capability;
    if (!cap.resolutions.includes(input.resolution)) throw badRequest('RESOLUTION_INVALID', '不支持这个分辨率');
    const allIds = spec.shots.map((s) => s.shotId);
    const shotIds = input.shotIds?.length ? [...new Set(input.shotIds)] : allIds;
    const unknown = shotIds.filter((id) => !allIds.includes(id));
    if (unknown.length) throw badRequest('SHOT_NOT_FOUND', '要生成的镜头不在当前故事板中');

    const active = await this.prisma.generationJob.findFirst({
      where: { projectId, status: { in: ['QUEUED', 'GENERATING', 'COMPOSING'] } },
    });
    if (active) throw conflict('JOB_ACTIVE', '上一个生成任务还没完成，请等它结束后再生成');

    const problems = await this.storyboards.checkReadiness(userId, spec, shotIds);
    if (problems.length) throw badRequest('NOT_READY', problems.join('；'), problems);

    const project = await this.prisma.project.findUniqueOrThrow({ where: { id: projectId }, include: { product: true } });
    const renderSpecs = await this.storyboards.buildShotSpecs(userId, spec, shotIds, input.resolution, project.product.name);
    const requests = renderSpecs.map<ClipRequest>((s) => ({ spec: s, compiled: this.video.compile(s) }));

    const ordered = allIds.filter((id) => shotIds.includes(id));
    try {
      const job = await this.prisma.$transaction(async (tx) => {
        const job = await tx.generationJob.create({
          data: {
            userId,
            projectId,
            storyboardId: row.id,
            kind: ordered.length === allIds.length ? 'FULL' : 'RESHOOT',
            resolution: input.resolution,
            shotIds: ordered,
            idempotencyKey: input.idempotencyKey,
            status: 'QUEUED',
            baseOutputId: project.currentOutputId,
          },
        });
        for (const shotId of ordered) {
          const shot = spec.shots.find((s) => s.shotId === shotId)!;
          const last = await tx.clip.findFirst({ where: { projectId, shotId }, orderBy: { version: 'desc' } });
          const req = requests.find((r) => r.spec.shotId === shotId)!;
          await tx.clip.create({
            data: {
              projectId,
              jobId: job.id,
              storyboardId: row.id,
              shotId,
              version: (last?.version ?? 0) + 1,
              specHash: shotSpecHash(spec, shot),
              provider: cap.provider,
              modelKey: cap.key,
              modelId: cap.modelId,
              resolution: input.resolution,
              durationSec: shot.durationSec,
              request: req as unknown as Prisma.InputJsonValue,
              status: 'QUEUED',
            },
          });
        }
        return job;
      });
      await this.queue.enqueue('tick', {});
      return this.jobView(job.id);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const again = await this.prisma.generationJob.findUnique({
          where: { userId_idempotencyKey: { userId, idempotencyKey: input.idempotencyKey } },
        });
        if (again) return this.jobView(again.id);
        throw conflict('JOB_CONFLICT', '同时提交了多个生成任务，请刷新后重试');
      }
      throw err;
    }
  }

  async requireJob(userId: string, jobId: string): Promise<GenerationJob> {
    const job = await this.prisma.generationJob.findFirst({ where: { id: jobId, userId } });
    if (!job) throw notFound('生成任务');
    return job;
  }

  async jobView(jobId: string) {
    const job = await this.prisma.generationJob.findUniqueOrThrow({
      where: { id: jobId },
      include: { clips: { orderBy: { queuedAt: 'asc' } } },
    });
    const queuedAhead = await this.prisma.clip.count({
      where: { status: 'QUEUED', queuedAt: { lt: job.clips[0]?.queuedAt ?? job.createdAt }, jobId: { not: job.id } },
    });
    return jsonSafe({
      id: job.id,
      projectId: job.projectId,
      kind: job.kind,
      status: job.status,
      resolution: job.resolution,
      shotIds: job.shotIds,
      outputId: job.outputId,
      errorMessage: job.errorMessage,
      createdAt: job.createdAt,
      finishedAt: job.finishedAt,
      queuedAhead,
      clips: job.clips.map((c) => ({
        id: c.id,
        shotId: c.shotId,
        version: c.version,
        status: c.status,
        errorMessage: c.errorMessage,
        submittedAt: c.submittedAt,
        finishedAt: c.finishedAt,
      })),
    });
  }

  /** 只能取消还在排队的镜头；已经开始生成的镜头无法取消 */
  async cancel(userId: string, jobId: string) {
    const job = await this.requireJob(userId, jobId);
    if (job.status !== 'QUEUED') throw conflict('NOT_CANCELLABLE', '任务已经开始生成，无法取消');
    const clips = await this.prisma.clip.findMany({ where: { jobId } });
    let cancelled = 0;
    let running = 0;
    for (const clip of clips) {
      if (clip.status === 'QUEUED') {
        const res = await this.prisma.clip.updateMany({
          where: { id: clip.id, status: 'QUEUED' },
          data: { status: 'CANCELLED', finishedAt: new Date() },
        });
        if (res.count) cancelled++;
        else running++;
      } else if (clip.status === 'SUBMITTED' && clip.providerTaskId) {
        const result = await this.video.cancelTask(clip.providerTaskId).catch(() => 'not_cancellable' as const);
        if (result === 'cancelled') {
          await this.prisma.clip.update({ where: { id: clip.id }, data: { status: 'CANCELLED', finishedAt: new Date() } });
          cancelled++;
        } else running++;
      } else if (!TERMINAL.includes(clip.status)) {
        running++;
      }
    }
    await this.aggregate(jobId);
    return { cancelled, notCancellable: running, job: await this.jobView(jobId) };
  }

  /** 调度：轮询进行中的任务，再把排队的片段提交到空出的并发位 */
  async tick() {
    await this.failStaleSubmitting();
    await this.pollActive();
    await this.dispatch();
  }

  private async failStaleSubmitting() {
    const stale = await this.prisma.clip.findMany({
      where: { status: 'SUBMITTING', submittedAt: { lt: new Date(Date.now() - SUBMITTING_STALE_MS) } },
    });
    for (const clip of stale) {
      await this.finishClip(clip, 'FAILED', 'SUBMIT_UNKNOWN', '提交视频任务时服务中断，无法确认是否提交成功，请重试这个镜头');
    }
  }

  private async pollActive() {
    const cap = this.video.capability;
    const env = getEnv();
    const clips = await this.prisma.clip.findMany({
      where: { status: { in: ['SUBMITTED', 'RUNNING'] }, providerTaskId: { not: null } },
      orderBy: [{ lastPolledAt: { sort: 'asc', nulls: 'first' } }],
      take: 50,
    });
    const gap = Math.ceil(1000 / Math.max(1, cap.limits.queryQps - 2));
    for (const clip of clips) {
      if (clip.submittedAt && Date.now() - clip.submittedAt.getTime() > env.VIDEO_TASK_TIMEOUT_MS) {
        await this.video.cancelTask(clip.providerTaskId!).catch(() => undefined);
        await this.finishClip(clip, 'FAILED', 'TIMEOUT', `视频生成超时（超过 ${Math.round(env.VIDEO_TASK_TIMEOUT_MS / 60000)} 分钟）`);
        continue;
      }
      try {
        const status = await this.video.getTask(clip.providerTaskId!);
        const data: Prisma.ClipUpdateInput = { lastPolledAt: new Date(), rawStatus: status.rawStatus };
        switch (status.state) {
          case 'queued':
            await this.prisma.clip.update({ where: { id: clip.id }, data });
            break;
          case 'running':
            await this.prisma.clip.update({ where: { id: clip.id }, data: { ...data, status: 'RUNNING' } });
            await this.aggregate(clip.jobId);
            break;
          case 'succeeded':
            if (!status.videoUrl) {
              await this.finishClip(clip, 'FAILED', 'NO_VIDEO_URL', '视频模型没有返回视频');
              break;
            }
            await this.prisma.clip.update({
              where: { id: clip.id },
              data: {
                ...data,
                status: 'TRANSFERRING',
                providerVideoUrl: status.videoUrl,
                usage: (status.usage ?? undefined) as Prisma.InputJsonValue | undefined,
                seed: status.seed !== undefined ? BigInt(status.seed) : undefined,
              },
            });
            await this.queue.enqueue('transfer', { clipId: clip.id }, { jobId: `transfer-${clip.id}` });
            await this.aggregate(clip.jobId);
            break;
          case 'failed':
            await this.finishClip(
              clip,
              'FAILED',
              status.error?.code ?? 'FAILED',
              friendlyProviderError(status.error?.code ?? '', status.error?.message ?? ''),
              status.usage,
            );
            break;
          case 'cancelled':
            await this.finishClip(clip, 'CANCELLED', 'CANCELLED', '任务已取消');
            break;
          default:
            this.logger.warn(`片段 ${clip.id} 收到未知状态：${status.rawStatus}`);
            await this.prisma.clip.update({ where: { id: clip.id }, data });
        }
      } catch (err) {
        if (err instanceof ProviderError && !err.retryable && err.httpStatus === 404) {
          await this.finishClip(clip, 'FAILED', 'TASK_NOT_FOUND', '视频任务已失效');
        } else {
          this.logger.warn(`查询片段 ${clip.id} 失败：${errorMessage(err)}`);
          await this.prisma.clip.update({ where: { id: clip.id }, data: { lastPolledAt: new Date() } });
        }
      }
      if (gap > 0 && clips.length > 1) await sleep(gap);
    }
  }

  private async dispatch() {
    const cap = this.video.capability;
    const inFlight = await this.prisma.clip.count({ where: { status: { in: IN_FLIGHT } } });
    let free = cap.limits.maxConcurrency - inFlight;
    if (free <= 0) return;
    const recent = await this.prisma.clip.count({ where: { submittedAt: { gt: new Date(Date.now() - 60_000) } } });
    free = Math.min(free, cap.limits.rpm - recent);
    if (free <= 0) return;
    const candidates = await this.prisma.clip.findMany({
      where: { status: 'QUEUED', OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }] },
      orderBy: { queuedAt: 'asc' },
      take: free,
    });
    for (const clip of candidates) {
      const claimed = await this.prisma.clip.updateMany({
        where: { id: clip.id, status: 'QUEUED' },
        data: { status: 'SUBMITTING', submittedAt: new Date() },
      });
      if (!claimed.count) continue;
      await this.submit(clip);
    }
  }

  private async resolveImage(ref: ImageSourceRef): Promise<ImageInput> {
    if (ref.type === 'virtual_portrait') return { kind: 'asset', uri: `asset://${ref.portraitId}` };
    return this.assets.toModelImage(ref.assetId);
  }

  private async submit(clip: Clip) {
    const request = clip.request as unknown as ClipRequest;
    try {
      const images = await Promise.all(request.compiled.images.map((ref) => this.resolveImage(ref)));
      const { providerTaskId } = await this.video.createTask({ compiled: request.compiled, images });
      await this.prisma.clip.update({
        where: { id: clip.id },
        data: { status: 'SUBMITTED', providerTaskId, submittedAt: new Date(), submitAttempts: { increment: 1 } },
      });
    } catch (err) {
      const attempts = clip.submitAttempts + 1;
      if (err instanceof ProviderError && err.retryable && attempts < MAX_SUBMIT_ATTEMPTS) {
        const delay = Math.min(5 * 60_000, 5000 * 2 ** attempts);
        await this.prisma.clip.update({
          where: { id: clip.id },
          data: {
            status: 'QUEUED',
            submittedAt: null,
            submitAttempts: attempts,
            nextAttemptAt: new Date(Date.now() + delay),
            errorMessage: `提交失败，将自动重试：${err.message}`,
          },
        });
        return;
      }
      const code = err instanceof ProviderError ? err.code : 'SUBMIT_FAILED';
      const message = err instanceof ProviderError ? friendlyProviderError(err.code, err.message) : `提交失败：${errorMessage(err)}`;
      await this.finishClip({ ...clip, submitAttempts: attempts }, 'FAILED', code, message);
    }
  }

  private async finishClip(clip: Clip, status: 'FAILED' | 'CANCELLED', code: string, message: string, usage?: unknown) {
    await this.prisma.clip.update({
      where: { id: clip.id },
      data: {
        status,
        errorCode: code,
        errorMessage: message,
        finishedAt: new Date(),
        providerVideoUrl: null,
        usage: usage ? (usage as Prisma.InputJsonValue) : undefined,
      },
    });
    await this.aggregate(clip.jobId);
  }

  /** 后台：下载视频片段（24 小时内）→ 转存 → 规范化 → 记录实际时长 */
  async transfer(clipId: string, ctx: JobContext) {
    const clip = await this.prisma.clip.findUnique({ where: { id: clipId }, include: { job: true } });
    if (!clip || clip.status !== 'TRANSFERRING' || !clip.providerVideoUrl) return;
    const tmpRoot = repoPath(getEnv().TMP_DIR);
    await mkdir(tmpRoot, { recursive: true });
    const dir = await mkdtemp(join(tmpRoot, 'clip-'));
    try {
      const raw = join(dir, 'raw.mp4');
      const normalized = join(dir, 'clip.mp4');
      const data = await httpDownload(clip.providerVideoUrl, 10 * 60_000);
      await writeFile(raw, data);
      const base = `users/${clip.job.userId}/clips/${clip.id}`;
      await this.storage.putFile(`${base}/raw.mp4`, raw, 'video/mp4');
      const size = frameSize(clip.resolution as Resolution);
      await normalizeClip(raw, normalized, { ...size, fps: OUTPUT_FPS });
      const info = await probe(normalized);
      await this.storage.putFile(`${base}/clip.mp4`, normalized, 'video/mp4');
      await this.prisma.clip.update({
        where: { id: clip.id },
        data: {
          status: 'SUCCEEDED',
          rawObjectKey: `${base}/raw.mp4`,
          objectKey: `${base}/clip.mp4`,
          actualDurationSec: info.durationSec,
          width: info.width,
          height: info.height,
          providerVideoUrl: null,
          finishedAt: new Date(),
          errorMessage: null,
        },
      });
      await this.aggregate(clip.jobId);
    } catch (err) {
      this.logger.warn(`片段 ${clip.id} 转存失败（第 ${ctx.attempt}/${ctx.maxAttempts} 次）：${errorMessage(err)}`);
      if (ctx.attempt < ctx.maxAttempts) throw err;
      await this.finishClip(clip, 'FAILED', 'TRANSFER_FAILED', `视频已生成，但下载转存失败：${errorMessage(err)}`);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  /** 汇总任务状态；全部镜头成功后创建成片版本并合成 */
  async aggregate(jobId: string) {
    const job = await this.prisma.generationJob.findUnique({ where: { id: jobId }, include: { clips: true } });
    if (!job || !['QUEUED', 'GENERATING'].includes(job.status)) return;
    const clips = job.clips;
    const pending = clips.filter((c) => !TERMINAL.includes(c.status));
    if (pending.length) {
      const started = clips.some((c) => ['RUNNING', 'TRANSFERRING', 'SUCCEEDED'].includes(c.status));
      const next = started ? 'GENERATING' : 'QUEUED';
      if (next !== job.status) {
        await this.prisma.generationJob.updateMany({ where: { id: job.id, status: job.status }, data: { status: next } });
      }
      return;
    }
    const succeeded = clips.filter((c) => c.status === 'SUCCEEDED');
    const failed = clips.filter((c) => c.status === 'FAILED');
    if (succeeded.length === clips.length) {
      const moved = await this.prisma.generationJob.updateMany({
        where: { id: job.id, status: { in: ['QUEUED', 'GENERATING'] } },
        data: { status: 'COMPOSING' },
      });
      if (moved.count) await this.outputs.createFromJob(job.id);
      return;
    }
    const status = failed.length === 0 ? 'CANCELLED' : succeeded.length > 0 ? 'PARTIAL_FAILED' : 'FAILED';
    const summary =
      status === 'CANCELLED'
        ? '任务已取消'
        : `${failed.length} 个镜头生成失败${succeeded.length ? `，${succeeded.length} 个镜头已完成并保留，可以只重试失败的镜头` : ''}`;
    await this.prisma.generationJob.updateMany({
      where: { id: job.id, status: { in: ['QUEUED', 'GENERATING'] } },
      data: { status, errorMessage: summary, finishedAt: new Date() },
    });
  }
}
