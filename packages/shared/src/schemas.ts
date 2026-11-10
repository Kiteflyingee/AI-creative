import { z } from 'zod';
import { CAPTION_MAX, NARRATION_HARD_LIMIT, REFERENCE_KINDS, STORY_TYPE_KEYS } from './constants';

/** 去掉换行和多余空白 */
const text = (max: number) =>
  z
    .string()
    .transform((s) => s.replace(/\s+/g, ' ').trim())
    .pipe(z.string().max(max));

export const storyDurationSchema = z.union([z.literal(15), z.literal(30), z.literal(60)]);

export const storylineSegmentSchema = z.object({
  startSec: z.number().int().min(0),
  endSec: z.number().int().positive(),
  content: text(200).pipe(z.string().min(1)),
});

/** 故事线（Kickart：标题 + 按时间段描述 + 视觉风格 + 时长） */
export const storylineContentSchema = z.object({
  title: text(40).pipe(z.string().min(1)),
  type: z.enum(STORY_TYPE_KEYS),
  style: text(60).pipe(z.string().min(1)),
  durationSec: storyDurationSchema,
  hook: text(80).pipe(z.string().min(1)),
  audience: text(80).default(''),
  segments: z.array(storylineSegmentSchema).min(2).max(12),
  sellingPointIds: z.array(z.string()).max(8).default([]),
});
export type StorylineContent = z.infer<typeof storylineContentSchema>;

/** 故事板参考图：商品 / 人物 / 场景 */
export const referenceSchema = z.object({
  refId: z.string().min(1),
  kind: z.enum(REFERENCE_KINDS),
  name: text(30).pipe(z.string().min(1)),
  description: text(200).default(''),
  /** AI 生成人物图、场景图时使用的图片提示词 */
  imagePrompt: text(800).default(''),
  /** 当前使用的图片；null 表示还没有图（生成中或只靠文字描述） */
  assetId: z.string().nullable().default(null),
  /** 商品图被 AI 重新生成后，指向商家原图；生成视频时原图一并作为参考 */
  originalAssetId: z.string().nullable().default(null),
});
export type Reference = z.infer<typeof referenceSchema>;

/** 镜头：按 Kickart 视频提示词公式拆成字段，另加口播、字幕和时长 */
export const shotSchema = z.object({
  shotId: z.string().min(1),
  purpose: text(20).default(''),
  durationSec: z.number().int().positive(),
  /** 参考图主体：本镜头出现哪些主体 */
  subject: text(200).default(''),
  /** 视频类型/目标 */
  videoType: text(60).default(''),
  /** 运镜方式 */
  camera: text(120).default(''),
  /** 主体动作 */
  action: text(300).default(''),
  /** 场景环境 */
  scene: text(200).default(''),
  /** 口播原文；空字符串表示本镜头没有口播 */
  narration: text(NARRATION_HARD_LIMIT * 2).default(''),
  /** 字幕原文（合成时叠加） */
  caption: text(CAPTION_MAX).default(''),
  /** 一致性约束 */
  consistency: text(200).default(''),
  /** 本镜头使用的参考图 refId */
  refIds: z.array(z.string()).max(6).default([]),
});
export type Shot = z.infer<typeof shotSchema>;

export const storyboardSpecSchema = z.object({
  schemaVersion: z.literal(1),
  durationSec: z.number().int().positive(),
  /** 全片统一的风格、光线描述，写入每个镜头的提示词 */
  styleProfile: text(200).default(''),
  /** 全片统一的音色描述，写入每个镜头的提示词 */
  voiceProfile: text(100).default(''),
  references: z.array(referenceSchema).max(20),
  shots: z.array(shotSchema).min(1).max(15),
});
export type StoryboardSpec = z.infer<typeof storyboardSpecSchema>;

/** 可修改的镜头字段（对话修改、表单编辑共用） */
export const SHOT_EDITABLE_FIELDS = [
  'purpose',
  'subject',
  'videoType',
  'camera',
  'action',
  'scene',
  'narration',
  'caption',
  'consistency',
] as const;
export type ShotEditableField = (typeof SHOT_EDITABLE_FIELDS)[number];

export const SHOT_FIELD_LABELS: Record<ShotEditableField | 'durationSec' | 'refIds', string> = {
  purpose: '镜头作用',
  subject: '参考图主体',
  videoType: '视频类型',
  camera: '运镜方式',
  action: '主体动作',
  scene: '场景环境',
  narration: '口播',
  caption: '字幕',
  consistency: '一致性约束',
  durationSec: '时长',
  refIds: '参考图',
};

/** Remotion 合成输入（服务端渲染与 H5 预览共用） */
export const compositionInputSchema = z.object({
  fps: z.number().int().positive(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  clips: z
    .array(
      z.object({
        src: z.string().min(1),
        durationInFrames: z.number().int().positive(),
      }),
    )
    .min(1),
  captions: z.array(
    z.object({
      text: z.string(),
      fromFrame: z.number().int().min(0),
      durationInFrames: z.number().int().positive(),
    }),
  ),
});
export type CompositionInput = z.infer<typeof compositionInputSchema>;
