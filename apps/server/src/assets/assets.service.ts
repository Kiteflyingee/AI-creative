import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Asset, AssetKind, FaceResolution } from '@prisma/client';
import { badRequest, notFound } from '../common/errors';
import { errorMessage, sha256 } from '../common/util';
import { getEnv } from '../config/env';
import { loadVirtualPortraits } from '../config/virtual-portraits';
import {
  COMPARE_PRODUCT_SYSTEM,
  compareProductSchema,
  DESCRIBE_PERSON_SYSTEM,
  describePersonSchema,
  INSPECT_IMAGE_SYSTEM,
  inspectImageSchema,
  PROMPT_VERSION,
} from '../creative/prompts';
import { checkImageAgainstLimits, readImageMeta, toDataUrl, toJpeg } from '../media/image';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectsService } from '../projects/projects.service';
import { LlmService } from '../providers/llm/llm.service';
import { ModelHub } from '../providers/model-hub';
import { defaultModels, imageCapability, videoCapability } from '../providers/registry';
import type { ImageInput } from '../providers/types';
import { JOB_QUEUE, type JobContext, type JobQueue } from '../queue/job-queue';
import { StorageService } from '../storage/storage.service';

export type GenerationMode =
  | { mode: 't2i' }
  | { mode: 'i2i_product'; instruction: string }
  | { mode: 'similar_person' };

const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const KIND_LABEL: Record<AssetKind, string> = { PRODUCT: '商品图', CHARACTER: '人物图', SCENE: '场景图' };

export const DEFAULT_PRODUCT_INSTRUCTION = '换成干净的浅色影棚背景，柔和商业布光';

@Injectable()
export class AssetsService {
  private readonly logger = new Logger(AssetsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly projects: ProjectsService,
    private readonly llm: LlmService,
    private readonly hub: ModelHub,
    @Inject(JOB_QUEUE) private readonly queue: JobQueue,
  ) {}

  async requireAsset(userId: string, assetId: string): Promise<Asset> {
    const asset = await this.prisma.asset.findFirst({ where: { id: assetId, userId } });
    if (!asset) throw notFound('图片');
    return asset;
  }

  /** 商家上传图片：按视频模型的参考图要求校验，合格才保存，随后后台检查人脸与质量 */
  async upload(userId: string, projectId: string, kind: AssetKind, file: { buffer: Buffer; size: number } | undefined) {
    const project = await this.projects.requireProject(userId, projectId);
    if (!file?.buffer?.length) throw badRequest('NO_FILE', '没有收到图片文件');
    const meta = await readImageMeta(file.buffer);
    if (!meta) throw badRequest('IMAGE_INVALID', '无法识别的图片文件');
    const reason = checkImageAgainstLimits(meta, videoCapability(project.videoModel).imageInput);
    if (reason) throw badRequest('IMAGE_INVALID', reason);

    const asset = await this.prisma.asset.create({
      data: {
        userId,
        productId: project.productId,
        projectId,
        kind,
        origin: 'UPLOAD',
        status: 'READY',
        mime: meta.mime,
        width: meta.width,
        height: meta.height,
        sizeBytes: meta.sizeBytes,
        sha256: sha256(file.buffer),
        label: KIND_LABEL[kind],
      },
    });
    const objectKey = `users/${userId}/assets/${asset.id}.${EXT[meta.mime] ?? 'img'}`;
    await this.storage.putBuffer(objectKey, file.buffer, meta.mime);
    const saved = await this.prisma.asset.update({ where: { id: asset.id }, data: { objectKey } });
    await this.queue.enqueue('inspect', { assetId: asset.id });
    await this.touch(projectId);
    return this.projects.assetView(saved);
  }

  async remove(userId: string, assetId: string) {
    const asset = await this.requireAsset(userId, assetId);
    // 已被故事板或片段引用的图片保留（历史版本仍要用），只从商品素材列表里移除
    await this.prisma.asset.update({ where: { id: asset.id }, data: { productId: null, projectId: null } });
    return { ok: true };
  }

  async updateLabel(userId: string, assetId: string, label: string) {
    const asset = await this.requireAsset(userId, assetId);
    return this.projects.assetView(await this.prisma.asset.update({ where: { id: asset.id }, data: { label } }));
  }

  /** 含真人脸的图片怎么处理（D-28） */
  async setFaceResolution(
    userId: string,
    assetId: string,
    input: { resolution: Exclude<FaceResolution, 'NONE'>; virtualPortraitId?: string },
  ) {
    const asset = await this.requireAsset(userId, assetId);
    if (asset.origin !== 'UPLOAD') throw badRequest('NOT_ALLOWED', 'AI 生成的图片不需要处理人脸');
    if (input.resolution !== 'EXCLUDED' && asset.kind !== 'CHARACTER') {
      throw badRequest('NOT_ALLOWED', '只有人物图可以换成 AI 相似人物（或虚拟人像）；商品图、场景图可以选择不用，或让 AI 重新生成');
    }
    if (input.resolution === 'VIRTUAL_PORTRAIT') {
      const { videoModel } = await this.modelsFor(asset);
      if (!videoCapability(videoModel).virtualPortraits) {
        throw badRequest('NOT_SUPPORTED', '当前视频模型不支持虚拟人像，请选择 AI 生成相似人物，或不用这张图');
      }
      const portrait = loadVirtualPortraits().find((p) => p.id === input.virtualPortraitId);
      if (!portrait) throw badRequest('PORTRAIT_NOT_FOUND', '没有找到这个虚拟人像');
      return this.projects.assetView(
        await this.prisma.asset.update({
          where: { id: asset.id },
          data: { faceResolution: 'VIRTUAL_PORTRAIT', virtualPortraitId: portrait.id, replacementAssetId: null },
        }),
      );
    }
    if (input.resolution === 'AI_SIMILAR') {
      const replacement = await this.createGenerated(userId, {
        productId: asset.productId,
        projectId: asset.projectId,
        kind: 'CHARACTER',
        label: 'AI 相似人物',
        prompt: null,
        sourceAssetId: asset.id,
        generation: { mode: 'similar_person' },
      });
      return this.projects.assetView(
        await this.prisma.asset.update({
          where: { id: asset.id },
          data: { faceResolution: 'AI_SIMILAR', replacementAssetId: replacement.id, virtualPortraitId: null },
        }),
      );
    }
    return this.projects.assetView(
      await this.prisma.asset.update({
        where: { id: asset.id },
        data: { faceResolution: 'EXCLUDED', replacementAssetId: null, virtualPortraitId: null },
      }),
    );
  }

  /** 创建一张待生成的 AI 图片，并放入后台生成队列 */
  async createGenerated(
    userId: string,
    input: {
      productId: string | null;
      projectId: string | null;
      kind: AssetKind;
      label: string;
      description?: string;
      prompt: string | null;
      sourceAssetId?: string | null;
      generation: GenerationMode;
    },
  ): Promise<Asset> {
    const asset = await this.prisma.asset.create({
      data: {
        userId,
        productId: input.productId,
        projectId: input.projectId,
        kind: input.kind,
        origin: 'AI_GENERATED',
        status: 'GENERATING',
        label: input.label,
        description: input.description ?? '',
        prompt: input.prompt,
        sourceAssetId: input.sourceAssetId ?? null,
        generation: input.generation,
        face: input.kind === 'SCENE' ? 'NONE' : 'UNKNOWN',
      },
    });
    await this.queue.enqueue('image', { assetId: asset.id });
    return asset;
  }

  /** 后台：生成图片 */
  async processImage(assetId: string, ctx: JobContext) {
    const asset = await this.prisma.asset.findUnique({ where: { id: assetId } });
    if (!asset || asset.status !== 'GENERATING') return;
    const generation = (asset.generation ?? { mode: 't2i' }) as GenerationMode;
    try {
      let prompt = asset.prompt ?? '';
      let inputs: ImageInput[] | undefined;
      if (generation.mode === 'similar_person') {
        const source = await this.prisma.asset.findUniqueOrThrow({ where: { id: asset.sourceAssetId! } });
        const photo = await toJpeg(await this.storage.getBuffer(source.objectKey!), 1024, 80);
        const described = await this.llm.completeJson(
          {
            purpose: 'describe_person',
            system: DESCRIBE_PERSON_SYSTEM,
            user: '请描述这张照片的人物风格。',
            images: [toDataUrl(photo)],
          },
          describePersonSchema,
        );
        prompt = described.imagePrompt;
      } else if (generation.mode === 'i2i_product') {
        const source = await this.prisma.asset.findUniqueOrThrow({ where: { id: asset.sourceAssetId! } });
        const original = await toJpeg(await this.storage.getBuffer(source.objectKey!), 2048, 90);
        inputs = [{ kind: 'base64', mime: 'image/jpeg', data: original.toString('base64') }];
        prompt = productImagePrompt(generation.instruction);
      }
      if (!prompt) throw new Error('缺少图片提示词');

      // 人脸图只用文生图生成（火山只信任同账号文生图产物中的人脸）
      const { imageModel } = await this.modelsFor(asset);
      const result = await this.hub.image(imageModel).generate({ prompt, images: inputs });
      const meta = await readImageMeta(result.data);
      const objectKey = `users/${asset.userId}/generated/${asset.id}.${EXT[result.mime] ?? 'img'}`;
      await this.storage.putBuffer(objectKey, result.data, result.mime);
      const cap = imageCapability(imageModel);
      const now = new Date();
      await this.prisma.asset.update({
        where: { id: asset.id },
        data: {
          status: 'READY',
          objectKey,
          prompt,
          mime: result.mime,
          width: meta?.width,
          height: meta?.height,
          sizeBytes: result.data.length,
          sha256: sha256(result.data),
          providerModelId: cap.modelId,
          providerUrl: result.providerUrl ?? null,
          // 结果链接按 1 小时余量提前视为过期
          providerUrlExpiresAt: result.providerUrl ? new Date(now.getTime() + (cap.resultUrlTtlHours - 1) * 3600_000) : null,
          generatedAt: now,
          face: asset.kind === 'CHARACTER' ? 'DETECTED' : 'NONE',
          errorMessage: null,
        },
      });
      if (generation.mode === 'i2i_product') await this.compareWithOriginal(asset.id);
    } catch (err) {
      this.logger.warn(`图片 ${asset.id} 生成失败（第 ${ctx.attempt}/${ctx.maxAttempts} 次）：${errorMessage(err)}`);
      if (ctx.attempt < ctx.maxAttempts) throw err;
      await this.prisma.asset.update({
        where: { id: asset.id },
        data: { status: 'FAILED', errorMessage: `图片生成失败：${errorMessage(err)}` },
      });
    }
    if (asset.projectId) await this.touch(asset.projectId);
  }

  /** AI 修改后的商品图与原图比对，结果只用于提醒商家核对 */
  private async compareWithOriginal(assetId: string) {
    const asset = await this.prisma.asset.findUniqueOrThrow({ where: { id: assetId } });
    const source = await this.prisma.asset.findUniqueOrThrow({ where: { id: asset.sourceAssetId! } });
    try {
      const [a, b] = await Promise.all([
        toJpeg(await this.storage.getBuffer(source.objectKey!), 1024, 80),
        toJpeg(await this.storage.getBuffer(asset.objectKey!), 1024, 80),
      ]);
      const result = await this.llm.completeJson(
        {
          purpose: 'compare_product_image',
          system: COMPARE_PRODUCT_SYSTEM,
          user: '第 1 张是商家原图，第 2 张是 AI 修改后的图。',
          images: [toDataUrl(a), toDataUrl(b)],
        },
        compareProductSchema,
      );
      await this.prisma.asset.update({
        where: { id: assetId },
        data: { comparison: { ...result, promptVersion: PROMPT_VERSION } },
      });
    } catch (err) {
      await this.prisma.asset.update({
        where: { id: assetId },
        data: { comparison: { consistent: 'review', issues: [`比对未完成：${errorMessage(err)}`] } },
      });
    }
  }

  /** 后台：上传图片的人脸检测与质量诊断（只做提示，不拦截） */
  async processInspect(assetId: string, ctx: JobContext) {
    const asset = await this.prisma.asset.findUnique({ where: { id: assetId } });
    if (!asset?.objectKey || asset.origin !== 'UPLOAD') return;
    try {
      const jpeg = await toJpeg(await this.storage.getBuffer(asset.objectKey), 1024, 80);
      const result = await this.llm.completeJson(
        {
          purpose: 'inspect_image',
          system: INSPECT_IMAGE_SYSTEM,
          user: `这是一张商家上传的${KIND_LABEL[asset.kind]}。`,
          images: [toDataUrl(jpeg)],
        },
        inspectImageSchema,
      );
      await this.prisma.asset.update({
        where: { id: asset.id },
        data: {
          face: result.hasHumanFace ? 'DETECTED' : 'NONE',
          quality: { level: result.quality, issues: result.issues },
          viewRole: asset.viewRole || result.viewRole,
          description: asset.description || result.description,
        },
      });
    } catch (err) {
      if (ctx.attempt < ctx.maxAttempts) throw err;
      await this.prisma.asset.update({
        where: { id: asset.id },
        data: { quality: { level: 'unknown', issues: [`图片检查未完成：${errorMessage(err)}`] } },
      });
    }
    if (asset.projectId) await this.touch(asset.projectId);
  }

  /**
   * 发给视频模型的图片（D-30）：
   * - AI 生成的图片原样发送（不压缩，保证同账号产物中的人脸被信任）；结果链接未过期时直接用原始链接
   * - 商家上传的图片：本地开发转 JPEG（最长边 2048）后以 Base64 发送；上线后用签名 URL
   */
  async toModelImage(assetId: string): Promise<ImageInput> {
    const asset = await this.prisma.asset.findUniqueOrThrow({ where: { id: assetId } });
    if (asset.status !== 'READY' || !asset.objectKey) throw new Error(`图片 ${asset.id} 不可用`);
    const env = getEnv();
    if (asset.origin === 'AI_GENERATED') {
      if (asset.providerUrl && asset.providerUrlExpiresAt && asset.providerUrlExpiresAt.getTime() > Date.now()) {
        return { kind: 'url', url: asset.providerUrl };
      }
      if (env.MODEL_IMAGE_TRANSPORT === 'signed_url') {
        return { kind: 'url', url: await this.storage.internalUrl(asset.objectKey, 2 * 3600) };
      }
      const original = await this.storage.getBuffer(asset.objectKey);
      return { kind: 'base64', mime: asset.mime ?? 'image/jpeg', data: original.toString('base64') };
    }
    if (env.MODEL_IMAGE_TRANSPORT === 'signed_url') {
      return { kind: 'url', url: await this.storage.internalUrl(asset.objectKey, 2 * 3600) };
    }
    const jpeg = await toJpeg(await this.storage.getBuffer(asset.objectKey), 2048, 90);
    return { kind: 'base64', mime: 'image/jpeg', data: jpeg.toString('base64') };
  }

  async touch(projectId: string) {
    await this.prisma.project.update({ where: { id: projectId }, data: { updatedAt: new Date() } }).catch(() => undefined);
  }

  /** 图片所属项目的模型组合（D-46）；找不到项目时用当前配置 */
  private async modelsFor(asset: Pick<Asset, 'projectId' | 'productId'>): Promise<{ videoModel: string; imageModel: string }> {
    const project = asset.projectId
      ? await this.prisma.project.findUnique({ where: { id: asset.projectId } })
      : asset.productId
        ? await this.prisma.project.findFirst({ where: { productId: asset.productId } })
        : null;
    return project ? { videoModel: project.videoModel, imageModel: project.imageModel } : defaultModels();
  }
}

export function productImagePrompt(instruction: string): string {
  const req = instruction.trim() || DEFAULT_PRODUCT_INSTRUCTION;
  return `保持图中商品的外观、形状、颜色、材质、图案、文字与 Logo 完全不变，不增减商品部件。${req}。9:16 竖屏构图，商品完整入镜并占画面 50% 以上，背景干净，没有多余文字，高质量商业摄影，用于电商短视频商品参考图。`;
}
