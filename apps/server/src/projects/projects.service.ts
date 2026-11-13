import { Injectable } from '@nestjs/common';
import { storyboardSpecSchema, storylineContentSchema, type StoryboardSpec } from '@ai-creative/shared';
import type { Asset, Clip, Output, Project } from '@prisma/client';
import { notFound } from '../common/errors';
import { jsonSafe } from '../common/util';
import { loadVirtualPortraits } from '../config/virtual-portraits';
import { PrismaService } from '../prisma/prisma.service';
import { defaultModels, videoCapability } from '../providers/registry';
import { StorageService } from '../storage/storage.service';

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /** 所有项目内资源都先经过这里校验归属 */
  async requireProject(userId: string, projectId: string): Promise<Project> {
    const project = await this.prisma.project.findFirst({ where: { id: projectId, userId } });
    if (!project) throw notFound('项目');
    return project;
  }

  /** 新建项目时记录当前配置的模型组合；之后改配置不影响已有项目（D-46） */
  async create(userId: string, name: string) {
    const models = defaultModels();
    return this.prisma.$transaction(async (tx) => {
      const product = await tx.product.create({ data: { userId, name } });
      const project = await tx.project.create({ data: { userId, productId: product.id, title: name, ...models } });
      return { projectId: project.id, productId: product.id };
    });
  }

  async list(userId: string) {
    const projects = await this.prisma.project.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      include: { product: true, jobs: { orderBy: { createdAt: 'desc' }, take: 1 } },
      take: 100,
    });
    const outputIds = projects.map((p) => p.currentOutputId).filter((id): id is string => Boolean(id));
    const outputs = await this.prisma.output.findMany({ where: { id: { in: outputIds } } });
    const byId = new Map(outputs.map((o) => [o.id, o]));
    return Promise.all(
      projects.map(async (p) => {
        const out = p.currentOutputId ? byId.get(p.currentOutputId) : undefined;
        return {
          id: p.id,
          title: p.title || p.product.name || '未命名商品',
          updatedAt: p.updatedAt,
          latestJobStatus: p.jobs[0]?.status ?? null,
          coverUrl: out?.coverKey ? await this.storage.publicUrl(out.coverKey) : null,
          hasOutput: Boolean(out && out.status === 'READY'),
        };
      }),
    );
  }

  async assetView(asset: Asset) {
    return {
      id: asset.id,
      kind: asset.kind,
      origin: asset.origin,
      status: asset.status,
      label: asset.label,
      viewRole: asset.viewRole,
      description: asset.description,
      quality: asset.quality,
      face: asset.face,
      faceResolution: asset.faceResolution,
      virtualPortraitId: asset.virtualPortraitId,
      replacementAssetId: asset.replacementAssetId,
      sourceAssetId: asset.sourceAssetId,
      comparison: asset.comparison,
      errorMessage: asset.errorMessage,
      width: asset.width,
      height: asset.height,
      url: asset.objectKey && asset.status === 'READY' ? await this.storage.publicUrl(asset.objectKey) : null,
      createdAt: asset.createdAt,
    };
  }

  async clipView(clip: Clip) {
    return {
      id: clip.id,
      shotId: clip.shotId,
      version: clip.version,
      jobId: clip.jobId,
      status: clip.status,
      specHash: clip.specHash,
      durationSec: clip.durationSec,
      actualDurationSec: clip.actualDurationSec,
      resolution: clip.resolution,
      errorCode: clip.errorCode,
      errorMessage: clip.errorMessage,
      queuedAt: clip.queuedAt,
      submittedAt: clip.submittedAt,
      finishedAt: clip.finishedAt,
      url: clip.objectKey && clip.status === 'SUCCEEDED' ? await this.storage.publicUrl(clip.objectKey) : null,
    };
  }

  async outputView(output: Output) {
    return {
      id: output.id,
      version: output.version,
      status: output.status,
      jobId: output.jobId,
      storyboardId: output.storyboardId,
      selection: output.selection,
      captions: output.captions,
      note: output.note,
      resolution: output.resolution,
      durationSec: output.durationSec,
      width: output.width,
      height: output.height,
      errorMessage: output.errorMessage,
      shareToken: output.shareToken,
      createdAt: output.createdAt,
      url: output.objectKey && output.status === 'READY' ? await this.storage.publicUrl(output.objectKey) : null,
      coverUrl: output.coverKey ? await this.storage.publicUrl(output.coverKey) : null,
    };
  }

  /** 项目完整状态（H5 各页面共用，轮询刷新） */
  async view(userId: string, projectId: string) {
    const project = await this.requireProject(userId, projectId);
    const [product, assets, storylines, storyboard, jobs, clips, outputs] = await Promise.all([
      this.prisma.product.findUniqueOrThrow({
        where: { id: project.productId },
        include: { facts: { orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] } },
      }),
      this.prisma.asset.findMany({
        where: { userId, OR: [{ productId: project.productId }, { projectId }] },
        orderBy: { createdAt: 'asc' },
      }),
      this.latestStorylines(projectId),
      this.prisma.storyboard.findFirst({ where: { projectId }, orderBy: { version: 'desc' } }),
      this.prisma.generationJob.findMany({ where: { projectId }, orderBy: { createdAt: 'desc' }, take: 10 }),
      this.prisma.clip.findMany({ where: { projectId }, orderBy: [{ shotId: 'asc' }, { version: 'asc' }] }),
      this.prisma.output.findMany({ where: { projectId }, orderBy: { version: 'desc' }, take: 20 }),
    ]);

    let spec: StoryboardSpec | null = null;
    if (storyboard) spec = storyboardSpecSchema.parse(storyboard.spec);
    const cap = videoCapability(project.videoModel);

    return jsonSafe({
      project: { id: project.id, title: project.title, currentOutputId: project.currentOutputId, targetDurationSec: project.targetDurationSec },
      product: {
        id: product.id,
        name: product.name,
        description: product.description,
        targetAudience: product.targetAudience,
        category: product.category,
        analysis: product.analysis,
        analyzedAt: product.analyzedAt,
        facts: product.facts.map((f) => ({ id: f.id, text: f.text, source: f.source, origin: f.origin, basis: f.basis })),
      },
      assets: await Promise.all(assets.map((a) => this.assetView(a))),
      storylines,
      storyboard: storyboard && spec ? { id: storyboard.id, version: storyboard.version, storylineId: storyboard.storylineId, spec } : null,
      jobs: jobs.map((j) => ({
        id: j.id,
        kind: j.kind,
        status: j.status,
        resolution: j.resolution,
        shotIds: j.shotIds,
        outputId: j.outputId,
        errorMessage: j.errorMessage,
        createdAt: j.createdAt,
        finishedAt: j.finishedAt,
      })),
      clips: await Promise.all(clips.map((c) => this.clipView(c))),
      outputs: await Promise.all(outputs.map((o) => this.outputView(o))),
      model: {
        // 商家不选择模型（D-25），这里只返回镜头时长规则与可选分辨率
        duration: cap.duration,
        resolutions: cap.resolutions,
      },
      // 虚拟人像只适用于支持它的视频模型（火山）；不支持时返回空列表，前端不显示该选项
      virtualPortraits: cap.virtualPortraits ? loadVirtualPortraits() : [],
    });
  }

  async latestStorylines(projectId: string) {
    const latest = await this.prisma.storyline.findFirst({ where: { projectId }, orderBy: { batch: 'desc' } });
    if (!latest) return [];
    const rows = await this.prisma.storyline.findMany({
      where: { projectId, batch: latest.batch },
      orderBy: { position: 'asc' },
    });
    return rows.map((r) => ({
      id: r.id,
      batch: r.batch,
      selected: r.selected,
      direction: r.direction,
      content: storylineContentSchema.parse(r.content),
    }));
  }
}
