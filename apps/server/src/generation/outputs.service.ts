import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  buildCompositionInput,
  frameSize,
  OUTPUT_FPS,
  storyboardSpecSchema,
  type Resolution,
  type StoryboardSpec,
} from '@ai-creative/shared';
import type { Clip, Output, Prisma } from '@prisma/client';
import { badRequest, notFound } from '../common/errors';
import { errorMessage, jsonSafe, randomToken } from '../common/util';
import { getEnv, repoPath } from '../config/env';
import { PROMPT_VERSION, QC_SYSTEM, qcSchema } from '../creative/prompts';
import { StoryboardService } from '../creative/storyboard.service';
import { extractFrame, probe, writeAiMetadata } from '../media/ffmpeg';
import { toDataUrl, toJpeg } from '../media/image';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectsService } from '../projects/projects.service';
import { LlmService } from '../providers/llm/llm.service';
import { COMPOSER, type Composer } from '../providers/types';
import { JOB_QUEUE, type JobContext, type JobQueue } from '../queue/job-queue';
import { StorageService } from '../storage/storage.service';

export type Selection = Array<{ shotId: string; clipId: string }>;
export type Captions = Array<{ shotId: string; text: string }>;

/** 隐式标识（D-29）：字段参照 GB 45438-2025 的元数据隐式标识，上线前按标准原文核对 */
export function aiMetadata(outputId: string): Record<string, string> {
  return {
    comment: 'AI生成内容（AIGC）',
    AIGC: JSON.stringify({
      Label: '1',
      ContentProducer: 'ai-creative',
      ProduceID: outputId,
      ReservedCode1: '',
      ContentPropagator: '',
      PropagateID: '',
      ReservedCode2: '',
    }),
  };
}

@Injectable()
export class OutputsService {
  private readonly logger = new Logger(OutputsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly projects: ProjectsService,
    private readonly storyboards: StoryboardService,
    private readonly llm: LlmService,
    @Inject(COMPOSER) private readonly composer: Composer,
    @Inject(JOB_QUEUE) private readonly queue: JobQueue,
  ) {}

  /**
   * 选出每个镜头使用的片段：优先用 overrides，其次用基准成片里的选择，最后用该镜头最新的成功片段。
   */
  private async resolveSelection(
    projectId: string,
    spec: StoryboardSpec,
    base: Selection | null,
    overrides: Record<string, string>,
  ): Promise<{ selection: Selection; missing: number[] }> {
    const clips = await this.prisma.clip.findMany({
      where: { projectId, status: 'SUCCEEDED' },
      orderBy: { version: 'desc' },
    });
    const byId = new Map(clips.map((c) => [c.id, c]));
    const selection: Selection = [];
    const missing: number[] = [];
    spec.shots.forEach((shot, index) => {
      const candidates = [overrides[shot.shotId], base?.find((b) => b.shotId === shot.shotId)?.clipId];
      let clip: Clip | undefined;
      for (const id of candidates) {
        const c = id ? byId.get(id) : undefined;
        if (c && c.shotId === shot.shotId) {
          clip = c;
          break;
        }
      }
      clip ??= clips.find((c) => c.shotId === shot.shotId);
      if (clip) selection.push({ shotId: shot.shotId, clipId: clip.id });
      else missing.push(index + 1);
    });
    return { selection, missing };
  }

  private async nextVersion(projectId: string) {
    const last = await this.prisma.output.findFirst({ where: { projectId }, orderBy: { version: 'desc' } });
    return (last?.version ?? 0) + 1;
  }

  /** 任务全部镜头完成后创建成片版本 */
  async createFromJob(jobId: string) {
    const job = await this.prisma.generationJob.findUniqueOrThrow({ where: { id: jobId }, include: { clips: true } });
    const board = await this.prisma.storyboard.findUniqueOrThrow({ where: { id: job.storyboardId } });
    const spec = storyboardSpecSchema.parse(board.spec);
    const base = job.baseOutputId
      ? ((await this.prisma.output.findUnique({ where: { id: job.baseOutputId } }))?.selection as Selection | undefined) ?? null
      : null;
    const overrides = Object.fromEntries(job.clips.filter((c) => c.status === 'SUCCEEDED').map((c) => [c.shotId, c.id]));
    const { selection, missing } = await this.resolveSelection(job.projectId, spec, base, overrides);
    if (missing.length) {
      await this.prisma.generationJob.update({
        where: { id: job.id },
        data: {
          status: 'PARTIAL_FAILED',
          errorMessage: `镜头 ${missing.join('、')} 还没有生成过，请先生成这些镜头`,
          finishedAt: new Date(),
        },
      });
      return null;
    }
    const output = await this.prisma.output.create({
      data: {
        projectId: job.projectId,
        version: await this.nextVersion(job.projectId),
        jobId: job.id,
        storyboardId: board.id,
        selection,
        captions: spec.shots.map((s) => ({ shotId: s.shotId, text: s.caption })),
        status: 'COMPOSING',
        resolution: job.resolution,
        note: job.kind === 'FULL' ? '生成成片' : `重新生成镜头 ${job.clips.map((c) => spec.shots.findIndex((s) => s.shotId === c.shotId) + 1).join('、')}`,
      },
    });
    await this.prisma.generationJob.update({ where: { id: job.id }, data: { outputId: output.id } });
    await this.queue.enqueue('compose', { outputId: output.id }, { jobId: `compose-${output.id}` });
    return output;
  }

  /** 不调用视频模型的重新合成：换回旧片段、修改字幕 */
  async recomposeCurrent(userId: string, projectId: string, note: string, overrides: Record<string, string> = {}) {
    const project = await this.projects.requireProject(userId, projectId);
    const { row, spec } = await this.storyboards.requireLatest(userId, projectId);
    const current = project.currentOutputId
      ? await this.prisma.output.findUnique({ where: { id: project.currentOutputId } })
      : null;
    if (!current) throw badRequest('NO_OUTPUT', '还没有成片，请先生成');
    const { selection, missing } = await this.resolveSelection(projectId, spec, current.selection as Selection, overrides);
    if (missing.length) throw badRequest('SHOT_NOT_GENERATED', `镜头 ${missing.join('、')} 还没有生成，请先生成这些镜头`);
    const output = await this.prisma.output.create({
      data: {
        projectId,
        version: await this.nextVersion(projectId),
        storyboardId: row.id,
        selection,
        captions: spec.shots.map((s) => ({ shotId: s.shotId, text: s.caption })),
        status: 'COMPOSING',
        resolution: current.resolution,
        note,
      },
    });
    await this.queue.enqueue('compose', { outputId: output.id }, { jobId: `compose-${output.id}` });
    return this.projects.outputView(output);
  }

  /** 回退：某个镜头换回指定的片段版本，只重新合成 */
  async selectClip(userId: string, projectId: string, shotId: string, clipId: string) {
    await this.projects.requireProject(userId, projectId);
    const clip = await this.prisma.clip.findFirst({ where: { id: clipId, projectId, shotId } });
    if (!clip) throw notFound('片段');
    if (clip.status !== 'SUCCEEDED') throw badRequest('CLIP_NOT_READY', '这个版本没有生成成功，不能使用');
    const { spec } = await this.storyboards.requireLatest(userId, projectId);
    const index = spec.shots.findIndex((s) => s.shotId === shotId);
    if (index < 0) throw badRequest('SHOT_NOT_FOUND', '这个镜头已不在当前故事板中');
    return this.recomposeCurrent(userId, projectId, `镜头 ${index + 1} 换成版本 ${clip.version}`, { [shotId]: clipId });
  }

  /** 修改字幕：保存为新的故事板版本，然后只重新合成（D-17） */
  async updateCaptions(userId: string, projectId: string, captions: Captions) {
    const { row, spec } = await this.storyboards.requireLatest(userId, projectId);
    const next = structuredClone(spec);
    for (const c of captions) {
      const shot = next.shots.find((s) => s.shotId === c.shotId);
      if (!shot) throw badRequest('SHOT_NOT_FOUND', '字幕对应的镜头不存在');
      shot.caption = c.text;
    }
    await this.storyboards.saveVersion(userId, projectId, next, { note: '修改字幕', expectedVersion: row.version });
    return this.recomposeCurrent(userId, projectId, '修改字幕', {});
  }

  async makeCurrent(userId: string, outputId: string) {
    const output = await this.requireOutput(userId, outputId);
    if (output.status !== 'READY') throw badRequest('OUTPUT_NOT_READY', '这个版本还没有合成完成');
    await this.prisma.project.update({ where: { id: output.projectId }, data: { currentOutputId: output.id } });
    return { ok: true };
  }

  async requireOutput(userId: string, outputId: string): Promise<Output> {
    const output = await this.prisma.output.findFirst({ where: { id: outputId, project: { userId } } });
    if (!output) throw notFound('成片');
    return output;
  }

  async downloadUrl(userId: string, outputId: string) {
    const output = await this.requireOutput(userId, outputId);
    if (output.status !== 'READY' || !output.objectKey) throw badRequest('OUTPUT_NOT_READY', '成片还没有合成完成');
    return { url: await this.storage.publicUrl(output.objectKey, 3600, `成片-v${output.version}.mp4`) };
  }

  async share(userId: string, outputId: string) {
    const output = await this.requireOutput(userId, outputId);
    if (output.status !== 'READY') throw badRequest('OUTPUT_NOT_READY', '成片还没有合成完成');
    const token = output.shareToken ?? randomToken(16);
    await this.prisma.output.update({ where: { id: output.id }, data: { shareToken: token } });
    return { token };
  }

  async unshare(userId: string, outputId: string) {
    const output = await this.requireOutput(userId, outputId);
    await this.prisma.output.update({ where: { id: output.id }, data: { shareToken: null } });
    return { ok: true };
  }

  /** 公开分享页（不需要登录） */
  async publicShare(token: string) {
    const output = await this.prisma.output.findUnique({ where: { shareToken: token }, include: { project: true } });
    if (!output || output.status !== 'READY' || !output.objectKey) throw notFound('分享');
    return {
      title: output.project.title,
      durationSec: output.durationSec,
      aiGenerated: true,
      videoUrl: await this.storage.publicUrl(output.objectKey, 6 * 3600),
      coverUrl: output.coverKey ? await this.storage.publicUrl(output.coverKey, 6 * 3600) : null,
    };
  }

  /** 后台：Remotion 合成 → 写入 AI 标识 → 截封面 */
  async compose(outputId: string, ctx: JobContext) {
    const output = await this.prisma.output.findUnique({ where: { id: outputId }, include: { project: true } });
    if (!output || output.status !== 'COMPOSING') return;
    const selection = output.selection as Selection;
    const captions = output.captions as Captions;
    const clips = await this.prisma.clip.findMany({ where: { id: { in: selection.map((s) => s.clipId) } } });
    const byId = new Map(clips.map((c) => [c.id, c]));
    const tmpRoot = repoPath(getEnv().TMP_DIR);
    await mkdir(tmpRoot, { recursive: true });
    const dir = await mkdtemp(join(tmpRoot, 'out-'));
    try {
      const items = await Promise.all(
        selection.map(async (s) => {
          const clip = byId.get(s.clipId);
          if (!clip?.objectKey) throw new Error(`镜头片段 ${s.clipId} 不存在`);
          return {
            src: await this.storage.internalUrl(clip.objectKey, 3 * 3600),
            durationSec: clip.actualDurationSec ?? clip.durationSec,
            caption: captions.find((c) => c.shotId === s.shotId)?.text ?? '',
          };
        }),
      );
      const size = frameSize(output.resolution as Resolution);
      const input = buildCompositionInput(items, { fps: OUTPUT_FPS, ...size });
      const rendered = join(dir, 'rendered.mp4');
      const final = join(dir, 'video.mp4');
      const cover = join(dir, 'cover.jpg');
      await this.composer.render(input, rendered);
      await writeAiMetadata(rendered, final, aiMetadata(output.id));
      const info = await probe(final);
      await extractFrame(final, Math.min(1, info.durationSec / 2), cover);
      const base = `users/${output.project.userId}/outputs/${output.id}`;
      await this.storage.putFile(`${base}/video.mp4`, final, 'video/mp4');
      await this.storage.putFile(`${base}/cover.jpg`, cover, 'image/jpeg');
      await this.prisma.$transaction([
        this.prisma.output.update({
          where: { id: output.id },
          data: {
            status: 'READY',
            objectKey: `${base}/video.mp4`,
            coverKey: `${base}/cover.jpg`,
            durationSec: info.durationSec,
            width: info.width,
            height: info.height,
            errorMessage: null,
          },
        }),
        this.prisma.project.update({ where: { id: output.projectId }, data: { currentOutputId: output.id } }),
        ...(output.jobId
          ? [this.prisma.generationJob.update({ where: { id: output.jobId }, data: { status: 'QC' } })]
          : []),
      ]);
      await this.queue.enqueue('qc', { outputId: output.id }, { jobId: `qc-${output.id}` });
    } catch (err) {
      this.logger.warn(`成片 ${output.id} 合成失败（第 ${ctx.attempt}/${ctx.maxAttempts} 次）：${errorMessage(err)}`);
      if (ctx.attempt < ctx.maxAttempts) throw err;
      await this.prisma.output.update({
        where: { id: output.id },
        data: { status: 'FAILED', errorMessage: `合成失败：${errorMessage(err)}` },
      });
      if (output.jobId) {
        await this.prisma.generationJob.update({
          where: { id: output.jobId },
          data: { status: 'FAILED', errorMessage: '镜头已生成，但合成成片失败，可以在作品页重试合成', finishedAt: new Date() },
        });
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  /** 合成失败后重试（不调用视频模型） */
  async retryCompose(userId: string, outputId: string) {
    const output = await this.requireOutput(userId, outputId);
    if (output.status !== 'FAILED') throw badRequest('NOT_FAILED', '这个版本不需要重试');
    await this.prisma.output.update({ where: { id: output.id }, data: { status: 'COMPOSING', errorMessage: null } });
    if (output.jobId) {
      await this.prisma.generationJob.update({ where: { id: output.jobId }, data: { status: 'COMPOSING', errorMessage: null, finishedAt: null } });
    }
    await this.queue.enqueue('compose', { outputId: output.id }, { jobId: `compose-${output.id}-${Date.now()}` });
    return { ok: true };
  }

  /** 后台：质检只记录，不拦截（D-12）。抽帧与商品图比对，检查是否出现模型生成的字幕 */
  async qc(outputId: string) {
    const output = await this.prisma.output.findUnique({ where: { id: outputId } });
    if (!output?.objectKey) return;
    const tmpRoot = repoPath(getEnv().TMP_DIR);
    await mkdir(tmpRoot, { recursive: true });
    const dir = await mkdtemp(join(tmpRoot, 'qc-'));
    try {
      const board = await this.prisma.storyboard.findUniqueOrThrow({ where: { id: output.storyboardId } });
      const spec = storyboardSpecSchema.parse(board.spec);
      const selection = output.selection as Selection;
      const clips = await this.prisma.clip.findMany({ where: { id: { in: selection.map((s) => s.clipId) } } });
      const video = join(dir, 'video.mp4');
      await this.storage.downloadToFile(output.objectKey, video);

      // 每个镜头抽中间一帧（最多 12 帧）
      const frames: string[] = [];
      const labels: string[] = [];
      let cursor = 0;
      for (const [i, s] of selection.entries()) {
        const clip = clips.find((c) => c.id === s.clipId);
        const dur = clip?.actualDurationSec ?? clip?.durationSec ?? 0;
        if (frames.length < 12) {
          const file = join(dir, `f${i}.jpg`);
          await extractFrame(video, cursor + dur / 2, file, 512);
          frames.push(toDataUrl(await readFile(file)));
          labels.push(`镜头${i + 1}`);
        }
        cursor += dur;
      }
      const productRefs = spec.references.filter((r) => r.kind === 'product' && (r.originalAssetId || r.assetId)).slice(0, 3);
      const productAssets = await this.prisma.asset.findMany({
        where: { id: { in: productRefs.map((r) => (r.originalAssetId ?? r.assetId)!) } },
      });
      const refImages = await Promise.all(
        productAssets.filter((a) => a.objectKey).map(async (a) => toDataUrl(await toJpeg(await this.storage.getBuffer(a.objectKey!), 768, 80))),
      );
      const result = await this.llm.completeJson(
        {
          purpose: 'qc',
          system: QC_SYSTEM,
          user: `图片顺序：${refImages.map((_, i) => `商品参考图${i + 1}`).concat(labels).join('、')}。`,
          images: [...refImages, ...frames],
        },
        qcSchema,
      );
      const state =
        result.productConsistency === 'fail' || result.unexpectedText
          ? 'FAIL'
          : result.productConsistency === 'review'
            ? 'REVIEW_REQUIRED'
            : 'PASS';
      await this.prisma.qcRecord.create({
        data: {
          outputId,
          state,
          reasons: result.issues,
          detail: { ...result, promptVersion: PROMPT_VERSION, frames: labels } as Prisma.InputJsonValue,
          modelId: this.llm.modelId,
        },
      });
    } catch (err) {
      await this.prisma.qcRecord.create({
        data: { outputId, state: 'ERROR', reasons: [errorMessage(err)], detail: {}, modelId: this.llm.modelId },
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
      if (output.jobId) {
        await this.prisma.generationJob.updateMany({
          where: { id: output.jobId, status: 'QC' },
          data: { status: 'COMPLETED', finishedAt: new Date() },
        });
      }
    }
  }

  async qcRecords(userId: string, outputId: string) {
    await this.requireOutput(userId, outputId);
    return jsonSafe(await this.prisma.qcRecord.findMany({ where: { outputId }, orderBy: { createdAt: 'desc' } }));
  }
}
