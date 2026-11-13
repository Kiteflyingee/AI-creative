import { Injectable } from '@nestjs/common';
import {
  allocateDurations,
  allowedValues,
  isDurationAllowed,
  NARRATION_HARD_LIMIT,
  recommendedShotCount,
  shotCountRange,
  storyboardSpecSchema,
  storylineContentSchema,
  type DurationRule,
  type Reference,
  type ReportCreativeProgress,
  type Resolution,
  type Shot,
  type StoryboardSpec,
} from '@ai-creative/shared';
import type { Asset } from '@prisma/client';
import { AssetsService, DEFAULT_PRODUCT_INSTRUCTION } from '../assets/assets.service';
import { badRequest, conflict, notFound } from '../common/errors';
import { sha256, shortId, stableStringify } from '../common/util';
import { loadVirtualPortraits } from '../config/virtual-portraits';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectsService } from '../projects/projects.service';
import { LlmService } from '../providers/llm/llm.service';
import { imageCapability, imageCapabilityByModelId, videoCapability } from '../providers/registry';
import type { ImageSourceRef, ShotRenderSpec, VideoModelCapability } from '../providers/types';
import {
  REWRITE_IMAGE_PROMPT_SYSTEM,
  rewriteImagePromptSchema,
  storyboardDraftSchema,
  storyboardSystem,
  type StoryboardDraft,
} from './prompts';

const MAX_SHOTS = 15;

/** 镜头内容哈希：用于判断片段生成后镜头是否被修改过 */
export function shotSpecHash(spec: StoryboardSpec, shot: Shot): string {
  const refs = spec.references
    .filter((r) => shot.refIds.includes(r.refId))
    .map((r) => ({ refId: r.refId, assetId: r.assetId, originalAssetId: r.originalAssetId, name: r.name, description: r.description }));
  const { caption: _caption, purpose: _purpose, ...rest } = shot;
  // 字幕在合成阶段叠加，改字幕不影响片段
  return sha256(stableStringify({ shot: rest, refs, style: spec.styleProfile, voice: spec.voiceProfile }));
}

@Injectable()
export class StoryboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectsService,
    private readonly llm: LlmService,
    private readonly assets: AssetsService,
  ) {}

  async latest(projectId: string) {
    const row = await this.prisma.storyboard.findFirst({ where: { projectId }, orderBy: { version: 'desc' } });
    return row ? { row, spec: storyboardSpecSchema.parse(row.spec) } : null;
  }

  async requireLatest(userId: string, projectId: string) {
    const project = await this.projects.requireProject(userId, projectId);
    const latest = await this.latest(projectId);
    if (!latest) throw notFound('故事板');
    return { ...latest, project };
  }

  /** 选定故事线后生成故事板：逐镜脚本 + 参考图规划；需要的人物图、场景图随即在后台生成 */
  async generateFromStoryline(userId: string, storylineId: string, onProgress?: ReportCreativeProgress) {
    const storyline = await this.prisma.storyline.findFirst({ where: { id: storylineId, project: { userId } } });
    if (!storyline) throw notFound('故事线');
    const project = await this.projects.requireProject(userId, storyline.projectId);
    const content = storylineContentSchema.parse(storyline.content);
    if (content.durationSec !== project.targetDurationSec) throw badRequest('DURATION_CHANGED', '成片时长已变更，请选择按当前时长生成的故事线');
    const product = await this.prisma.product.findUniqueOrThrow({
      where: { id: project.productId },
      include: { facts: { orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] } },
    });
    const confirmed = product.facts.filter((f) => f.source === 'MERCHANT_CONFIRMED');
    const uploads = await this.prisma.asset.findMany({
      where: { productId: product.id, origin: 'UPLOAD', status: 'READY' },
      orderBy: { createdAt: 'asc' },
    });
    const productImages = uploads.filter((a) => a.kind === 'PRODUCT' && a.faceResolution !== 'EXCLUDED');
    if (productImages.length === 0) throw badRequest('IMAGE_REQUIRED', '没有可用的商品图');
    onProgress?.({ phase: 'preparing' });
    const characters = uploads.filter((a) => a.kind === 'CHARACTER' && a.faceResolution !== 'EXCLUDED');
    const scenes = uploads.filter((a) => a.kind === 'SCENE' && a.faceResolution !== 'EXCLUDED');

    const cap = videoCapability(project.videoModel);
    const total = content.durationSec;
    const range = shotCountRange(total, cap.duration);
    const maxShots = Math.min(range.max, MAX_SHOTS);
    const target = recommendedShotCount(total, cap.duration, MAX_SHOTS);
    const keyed = {
      products: productImages.map((a, i) => ({ key: `P${i + 1}`, asset: a })),
      characters: characters.map((a, i) => ({ key: `C${i + 1}`, asset: a })),
      scenes: scenes.map((a, i) => ({ key: `S${i + 1}`, asset: a })),
    };
    const describe = (a: Asset) => `${a.viewRole || a.label}：${a.description || '（无描述）'}`;
    const user = [
      `商品名称：${product.name}`,
      `商品描述：${product.description || '（未填写）'}`,
      `目标受众：${content.audience || product.targetAudience || '（未填写）'}`,
      `已确认卖点（只能使用这些信息）：\n${confirmed.map((f) => `- ${f.text}`).join('\n') || '（无）'}`,
      `选定的故事线：\n标题：${content.title}\n类型：${content.type}\n风格：${content.style}\n开场钩子：${content.hook}\n总时长：${total} 秒\n${content.segments.map((s) => `${s.startSec}-${s.endSec}s：${s.content}`).join('\n')}`,
      `镜头数：${range.min > maxShots ? maxShots : range.min}–${maxShots} 个，建议 ${target} 个；镜头时长之和必须等于 ${total} 秒。`,
      `商品图（refs 里用 key 引用）：\n${keyed.products.map((p) => `${p.key}. ${describe(p.asset)}`).join('\n')}`,
      keyed.characters.length
        ? `商家上传的人物图：\n${keyed.characters.map((c) => `${c.key}. ${describe(c.asset)}`).join('\n')}`
        : '商家没有上传人物图。',
      keyed.scenes.length
        ? `商家上传的场景图：\n${keyed.scenes.map((s) => `${s.key}. ${describe(s.asset)}`).join('\n')}`
        : '商家没有上传场景图。',
    ].join('\n\n');

    const validKeys = new Set([...keyed.products, ...keyed.characters, ...keyed.scenes].map((x) => x.key));
    const draft = await this.llm.completeJson(
      { purpose: 'storyboard', system: storyboardSystem(cap.duration), user, thinking: true, maxTokens: 16000 },
      storyboardDraftSchema,
      {
        onProgress,
        validate: (d) => {
          if (d.shots.length < range.min || d.shots.length > maxShots) {
            return `镜头数必须在 ${range.min}–${maxShots} 之间，现在是 ${d.shots.length}`;
          }
          const defined = new Set([...validKeys, ...d.characters.map((c) => c.key), ...d.scenes.map((s) => s.key)]);
          const bad = d.shots.flatMap((s) => s.refs).filter((k) => !defined.has(k));
          if (bad.length) return `refs 引用了不存在的 key：${[...new Set(bad)].join('、')}`;
          const missingPrompt = [...d.characters, ...d.scenes].filter((x) => !validKeys.has(x.key) && !x.imagePrompt);
          if (missingPrompt.length) return `新人物、新场景必须写 imagePrompt：${missingPrompt.map((x) => x.key).join('、')}`;
          const longNarration = d.shots.findIndex((s) => s.narration.length > NARRATION_HARD_LIMIT);
          if (longNarration >= 0) return `第 ${longNarration + 1} 个镜头的口播超过 ${NARRATION_HARD_LIMIT} 字`;
          return null;
        },
      },
    );

    onProgress?.({ phase: 'saving' });
    const spec = await this.buildSpecFromDraft(userId, project.id, product.id, draft, keyed, total, cap.duration);
    const saved = await this.saveVersion(userId, project.id, spec, { storylineId: storyline.id, note: '由故事线生成' });
    await this.prisma.$transaction([
      this.prisma.storyline.updateMany({ where: { projectId: project.id }, data: { selected: false } }),
      this.prisma.storyline.update({ where: { id: storyline.id }, data: { selected: true } }),
    ]);
    return saved;
  }

  private async buildSpecFromDraft(
    userId: string,
    projectId: string,
    productId: string,
    draft: StoryboardDraft,
    keyed: {
      products: Array<{ key: string; asset: Asset }>;
      characters: Array<{ key: string; asset: Asset }>;
      scenes: Array<{ key: string; asset: Asset }>;
    },
    total: number,
    rule: DurationRule,
  ): Promise<StoryboardSpec> {
    const refByKey = new Map<string, Reference>();
    const references: Reference[] = [];
    for (const p of keyed.products) {
      const ref: Reference = {
        refId: shortId('prd'),
        kind: 'product',
        name: p.asset.viewRole ? `商品${p.asset.viewRole}` : `商品图${p.key.slice(1)}`,
        description: p.asset.description,
        imagePrompt: '',
        assetId: p.asset.id,
        originalAssetId: null,
      };
      refByKey.set(p.key, ref);
      references.push(ref);
    }
    const addPlanned = async (
      kind: 'character' | 'scene',
      items: StoryboardDraft['characters'],
      uploaded: Array<{ key: string; asset: Asset }>,
    ) => {
      for (const item of items) {
        if (refByKey.has(item.key)) continue;
        const existing = uploaded.find((u) => u.key === item.key);
        let assetId: string | null = existing?.asset.id ?? null;
        if (!existing) {
          const generated = await this.assets.createGenerated(userId, {
            productId,
            projectId,
            kind: kind === 'character' ? 'CHARACTER' : 'SCENE',
            label: item.name,
            description: item.description,
            prompt: item.imagePrompt,
            generation: { mode: 't2i' },
          });
          assetId = generated.id;
        }
        const ref: Reference = {
          refId: shortId(kind === 'character' ? 'chr' : 'scn'),
          kind,
          name: item.name,
          description: item.description || existing?.asset.description || '',
          imagePrompt: item.imagePrompt,
          assetId,
          originalAssetId: null,
        };
        refByKey.set(item.key, ref);
        references.push(ref);
      }
    };
    await addPlanned('character', draft.characters, keyed.characters);
    await addPlanned('scene', draft.scenes, keyed.scenes);

    const allocation = allocateDurations(
      draft.shots.map((s) => s.durationSec),
      total,
      rule,
    );
    if (!allocation.ok) throw badRequest('DURATION_INVALID', allocation.message);
    const shots: Shot[] = draft.shots.map((s, i) => ({
      shotId: shortId('shot'),
      purpose: s.purpose,
      durationSec: allocation.durations[i]!,
      subject: s.subject,
      videoType: s.videoType,
      camera: s.camera,
      action: s.action,
      scene: s.scene,
      narration: s.narration,
      caption: s.caption,
      consistency: s.consistency,
      refIds: [...new Set(s.refs.map((k) => refByKey.get(k)?.refId).filter((x): x is string => Boolean(x)))],
    }));
    return storyboardSpecSchema.parse({
      schemaVersion: 1,
      durationSec: total,
      styleProfile: draft.styleProfile,
      voiceProfile: draft.voiceProfile,
      references,
      shots,
    });
  }

  /** 校验并保存为新版本（每次修改都生成新版本，旧版本保留） */
  async saveVersion(
    userId: string,
    projectId: string,
    input: unknown,
    opts: { storylineId?: string; note?: string; expectedVersion?: number } = {},
  ) {
    const project = await this.projects.requireProject(userId, projectId);
    const parsed = storyboardSpecSchema.safeParse(input);
    if (!parsed.success) {
      throw badRequest('INVALID_STORYBOARD', `故事板不合法：${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.')} ${i.message}`).join('；')}`);
    }
    const spec = parsed.data;
    await this.validateIntegrity(userId, spec, videoCapability(project.videoModel).duration);
    spec.durationSec = spec.shots.reduce((sum, s) => sum + s.durationSec, 0);

    const latest = await this.latest(projectId);
    if (opts.expectedVersion !== undefined && latest && latest.row.version !== opts.expectedVersion) {
      throw conflict('STORYBOARD_CHANGED', '故事板已经更新，请刷新后再修改');
    }
    const storylineId = opts.storylineId ?? latest?.row.storylineId;
    if (!storylineId) throw badRequest('STORYLINE_REQUIRED', '请先选择故事线');
    const row = await this.prisma.storyboard.create({
      data: {
        projectId,
        storylineId,
        version: (latest?.row.version ?? 0) + 1,
        spec,
        videoModel: project.videoModel,
        note: opts.note ?? '',
      },
    });
    await this.prisma.project.update({ where: { id: projectId }, data: { updatedAt: new Date() } });
    return { id: row.id, version: row.version, spec };
  }

  private async validateIntegrity(userId: string, spec: StoryboardSpec, rule: DurationRule) {
    const refIds = new Set<string>();
    for (const ref of spec.references) {
      if (refIds.has(ref.refId)) throw badRequest('INVALID_STORYBOARD', `参考图 id 重复：${ref.refId}`);
      refIds.add(ref.refId);
    }
    const shotIds = new Set<string>();
    for (const [i, shot] of spec.shots.entries()) {
      if (shotIds.has(shot.shotId)) throw badRequest('INVALID_STORYBOARD', `镜头 id 重复：${shot.shotId}`);
      shotIds.add(shot.shotId);
      const unknown = shot.refIds.filter((r) => !refIds.has(r));
      if (unknown.length) throw badRequest('INVALID_STORYBOARD', `镜头 ${i + 1} 引用了不存在的参考图`);
      if (!isDurationAllowed(shot.durationSec, rule)) {
        throw badRequest('DURATION_INVALID', `镜头 ${i + 1} 的时长 ${shot.durationSec} 秒不可用，可选：${describeRule(rule)}`);
      }
    }
    const assetIds = spec.references.flatMap((r) => [r.assetId, r.originalAssetId]).filter((x): x is string => Boolean(x));
    if (assetIds.length) {
      const owned = await this.prisma.asset.count({ where: { id: { in: [...new Set(assetIds)] }, userId } });
      if (owned !== new Set(assetIds).size) throw badRequest('INVALID_STORYBOARD', '参考图不存在或无权使用');
    }
  }

  /** 修改总时长（15/30/60 秒），按现有镜头时长比例重新分配 */
  async setTotalDuration(userId: string, projectId: string, total: number, expectedVersion?: number) {
    const { spec, row, project } = await this.requireLatest(userId, projectId);
    const next = applyTotalDuration(spec, total, videoCapability(project.videoModel).duration);
    return this.saveVersion(userId, projectId, next, { note: `总时长改为 ${total} 秒`, expectedVersion: expectedVersion ?? row.version });
  }

  /** 重新生成参考图：商品图走图生图（原图保留），人物、场景图走文生图 */
  async regenerateReference(userId: string, projectId: string, refId: string, instruction = '') {
    const { spec, row, project } = await this.requireLatest(userId, projectId);
    const ref = spec.references.find((r) => r.refId === refId);
    if (!ref) throw notFound('参考图');
    const next = structuredClone(spec);
    const target = next.references.find((r) => r.refId === refId)!;
    if (ref.kind === 'product') {
      const sourceId = ref.originalAssetId ?? ref.assetId;
      if (!sourceId) throw badRequest('NO_SOURCE', '这张商品图没有原图，请先上传');
      const source = await this.assets.requireAsset(userId, sourceId);
      if (!imageCapability(project.imageModel).imageToImage) throw badRequest('NOT_SUPPORTED', '当前图片模型不支持修改商品图');
      const generated = await this.assets.createGenerated(userId, {
        productId: project.productId,
        projectId,
        kind: 'PRODUCT',
        label: `${ref.name}（AI 修改）`,
        prompt: null,
        sourceAssetId: source.id,
        generation: { mode: 'i2i_product', instruction: instruction || DEFAULT_PRODUCT_INSTRUCTION },
      });
      target.assetId = generated.id;
      target.originalAssetId = source.id;
    } else {
      let prompt = ref.imagePrompt || `${ref.name}：${ref.description}`;
      if (instruction) {
        const rewritten = await this.llm.completeJson(
          {
            purpose: 'rewrite_image_prompt',
            system: REWRITE_IMAGE_PROMPT_SYSTEM,
            user: `图片类型：${ref.kind === 'character' ? '人物图' : '场景图'}\n原提示词：${prompt}\n修改要求：${instruction}`,
          },
          rewriteImagePromptSchema,
        );
        prompt = rewritten.imagePrompt;
      }
      const generated = await this.assets.createGenerated(userId, {
        productId: project.productId,
        projectId,
        kind: ref.kind === 'character' ? 'CHARACTER' : 'SCENE',
        label: ref.name,
        description: ref.description,
        prompt,
        generation: { mode: 't2i' },
      });
      target.assetId = generated.id;
      target.imagePrompt = prompt;
    }
    return this.saveVersion(userId, projectId, next, { note: `重新生成参考图：${ref.name}`, expectedVersion: row.version });
  }

  /** 换成商家上传的图片，或把 AI 修改过的商品图换回原图 */
  async replaceReferenceImage(userId: string, projectId: string, refId: string, assetId: string | 'original') {
    const { spec, row } = await this.requireLatest(userId, projectId);
    const next = structuredClone(spec);
    const ref = next.references.find((r) => r.refId === refId);
    if (!ref) throw notFound('参考图');
    if (assetId === 'original') {
      if (!ref.originalAssetId) throw badRequest('NO_ORIGINAL', '这张图没有原图');
      ref.assetId = ref.originalAssetId;
      ref.originalAssetId = null;
    } else {
      const asset = await this.assets.requireAsset(userId, assetId);
      const expected = ref.kind === 'product' ? 'PRODUCT' : ref.kind === 'character' ? 'CHARACTER' : 'SCENE';
      if (asset.kind !== expected) throw badRequest('KIND_MISMATCH', '图片类型与参考图类型不一致');
      ref.assetId = asset.id;
      ref.originalAssetId = null;
    }
    return this.saveVersion(userId, projectId, next, { note: `更换参考图：${ref.name}`, expectedVersion: row.version });
  }

  /**
   * 生成前检查（D-41 的前置条件）。返回商家能看懂的问题列表，空数组表示可以生成。
   */
  async checkReadiness(userId: string, spec: StoryboardSpec, shotIds: string[], videoModel: string): Promise<string[]> {
    const problems: string[] = [];
    const cap = videoCapability(videoModel);
    const shots = spec.shots.filter((s) => shotIds.includes(s.shotId));
    const usedRefIds = new Set(shots.flatMap((s) => s.refIds));
    const refs = spec.references.filter((r) => usedRefIds.has(r.refId));
    const ids = refs.flatMap((r) => [r.assetId, r.originalAssetId]).filter((x): x is string => Boolean(x));
    const assets = await this.prisma.asset.findMany({ where: { id: { in: ids }, userId } });
    const replacementIds = assets.map((a) => a.replacementAssetId).filter((x): x is string => Boolean(x));
    const replacements = await this.prisma.asset.findMany({ where: { id: { in: replacementIds }, userId } });
    const byId = new Map([...assets, ...replacements].map((a) => [a.id, a]));
    const portraitsEnabled = cap.virtualPortraits && loadVirtualPortraits().length > 0;

    for (const ref of refs) {
      for (const id of [ref.assetId, ref.originalAssetId]) {
        if (!id) continue;
        const asset = byId.get(id);
        if (!asset) {
          problems.push(`参考图「${ref.name}」不存在`);
          continue;
        }
        problems.push(...assetProblems(ref.name, asset, byId, cap, portraitsEnabled));
      }
    }
    shots.forEach((shot, i) => {
      const n = spec.shots.indexOf(shot) + 1;
      if (!isDurationAllowed(shot.durationSec, cap.duration)) problems.push(`镜头 ${n} 的时长不可用（可选 ${describeRule(cap.duration)}）`);
      if (shot.narration.length > NARRATION_HARD_LIMIT) problems.push(`镜头 ${n} 的口播超过 ${NARRATION_HARD_LIMIT} 字，模型很难说完，请缩短`);
      if (!shot.action && !shot.subject) problems.push(`镜头 ${n} 没有写画面内容`);
      void i;
    });
    return [...new Set(problems)];
  }

  /** 把故事板镜头编译成与模型无关的生成规格；含真人脸的图片按商家选择替换（D-28） */
  async buildShotSpecs(userId: string, spec: StoryboardSpec, shotIds: string[], resolution: Resolution, productName: string) {
    const ids = spec.references.flatMap((r) => [r.assetId, r.originalAssetId]).filter((x): x is string => Boolean(x));
    const assets = await this.prisma.asset.findMany({ where: { id: { in: ids }, userId } });
    const byId = new Map(assets.map((a) => [a.id, a]));
    const source = (assetId: string | null): ImageSourceRef | null => {
      if (!assetId) return null;
      const asset = byId.get(assetId);
      if (!asset) return null;
      if (asset.origin === 'UPLOAD' && asset.face === 'DETECTED') {
        if (asset.faceResolution === 'VIRTUAL_PORTRAIT' && asset.virtualPortraitId) {
          return { type: 'virtual_portrait', portraitId: asset.virtualPortraitId };
        }
        if (asset.faceResolution === 'AI_SIMILAR' && asset.replacementAssetId) {
          return { type: 'asset', assetId: asset.replacementAssetId };
        }
        // 不用这张图（或尚未处理）：只靠文字描述，不发送含真人脸的原图
        return null;
      }
      if (asset.faceResolution === 'EXCLUDED') return null;
      return { type: 'asset', assetId: asset.id };
    };

    return spec.shots
      .filter((s) => shotIds.includes(s.shotId))
      .map<ShotRenderSpec>((shot) => {
        const references: ShotRenderSpec['references'] = [];
        for (const refId of shot.refIds) {
          const ref = spec.references.find((r) => r.refId === refId);
          if (!ref) continue;
          references.push({
            refId: ref.refId,
            kind: ref.kind,
            name: ref.name,
            description: ref.description,
            role: 'primary',
            image: source(ref.assetId),
          });
          if (ref.kind === 'product' && ref.originalAssetId) {
            references.push({
              refId: ref.refId,
              kind: 'product',
              name: ref.name,
              description: '',
              role: 'original_detail',
              image: source(ref.originalAssetId),
            });
          }
        }
        return {
          shotId: shot.shotId,
          durationSec: shot.durationSec,
          resolution,
          aspectRatio: '9:16',
          productName,
          references,
          fields: {
            purpose: shot.purpose,
            subject: shot.subject,
            videoType: shot.videoType,
            camera: shot.camera,
            action: shot.action,
            scene: shot.scene,
            narration: shot.narration,
            consistency: shot.consistency,
          },
          styleProfile: spec.styleProfile,
          voiceProfile: spec.voiceProfile,
        };
      });
  }
}

/** 含真人脸时商家可以选的处理方式（虚拟人像只在视频模型支持且已配置清单时出现） */
export function faceChoicesText(portraitsEnabled: boolean): string {
  return portraitsEnabled ? '换成虚拟人像、AI 生成相似人物，或不用这张图' : '换成 AI 生成相似人物，或不用这张图';
}

function assetProblems(
  name: string,
  asset: Asset,
  byId: Map<string, Asset>,
  cap: VideoModelCapability,
  portraitsEnabled: boolean,
): string[] {
  if (asset.status === 'GENERATING') return [`参考图「${name}」还在生成中，请稍等`];
  if (asset.status === 'FAILED') return [`参考图「${name}」生成失败，请重新生成或换一张`];
  if (asset.status !== 'READY') return [`参考图「${name}」不可用`];
  if (asset.origin === 'UPLOAD' && asset.face === 'DETECTED' && cap.faceInput !== 'accept') {
    if (asset.faceResolution === 'NONE') {
      return [`「${name}」的图片里有真人脸，请选择${faceChoicesText(portraitsEnabled)}`];
    }
    if (asset.faceResolution === 'VIRTUAL_PORTRAIT' && !cap.virtualPortraits) {
      return [`「${name}」选的虚拟人像不能用于当前视频模型，请${faceChoicesText(false)}`];
    }
    if (asset.faceResolution === 'AI_SIMILAR') {
      const rep = asset.replacementAssetId ? byId.get(asset.replacementAssetId) : undefined;
      if (!rep) return [`「${name}」的 AI 相似人物不存在，请重新选择`];
      return assetProblems(`${name}（AI 相似人物）`, rep, byId, cap, portraitsEnabled);
    }
  }
  // 火山只信任同账号 Seedream 文生图产物中的人脸，且有时间限制
  if (asset.origin === 'AI_GENERATED' && asset.kind === 'CHARACTER' && cap.faceInput === 'asset_or_trusted') {
    const trust = imageCapabilityByModelId(asset.providerModelId)?.trustedFaceForVideoProvider;
    if (trust?.provider !== cap.provider) {
      return [`AI 人物图「${name}」不是用当前视频模型认可的图片模型生成的，请在故事板里重新生成这个人物`];
    }
    if (asset.generatedAt) {
      const ageDays = (Date.now() - asset.generatedAt.getTime()) / 86400_000;
      if (ageDays > trust.days) {
        return [`AI 人物图「${name}」已超过 ${trust.days} 天，视频模型不再接受，请重新生成人物${portraitsEnabled ? '或换成虚拟人像' : ''}`];
      }
    }
  }
  return [];
}

export function describeRule(rule: { min: number; max: number; allowed?: readonly number[] }): string {
  const values = allowedValues({ ...rule, recommended: rule.min });
  return rule.allowed?.length ? `${values.join('、')} 秒` : `${rule.min}–${rule.max} 秒`;
}

/** 按比例把总时长重新分配给各镜头 */
export function applyTotalDuration(spec: StoryboardSpec, total: number, rule: DurationRule): StoryboardSpec {
  const result = allocateDurations(
    spec.shots.map((s) => s.durationSec),
    total,
    rule,
  );
  if (!result.ok) throw badRequest('DURATION_INVALID', result.message);
  const next = structuredClone(spec);
  next.shots.forEach((s, i) => (s.durationSec = result.durations[i]!));
  next.durationSec = total;
  return next;
}
