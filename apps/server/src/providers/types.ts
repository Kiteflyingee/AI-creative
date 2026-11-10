import type { DurationRule, ReferenceKind, Resolution } from '@ai-creative/shared';

/** 人脸输入规则：reject = 不接受；asset_or_trusted = 只接受素材库人像或同账号模型产物；accept = 直接接受 */
export type FaceInputPolicy = 'reject' | 'asset_or_trusted' | 'accept';

export interface ImageInputLimits {
  formats: readonly string[];
  minSide: number;
  maxSide: number;
  minRatio: number;
  maxRatio: number;
  maxBytes: number;
}

/** 视频模型能力登记表的一项（D-39） */
export interface VideoModelCapability {
  key: string;
  label: string;
  provider: string;
  modelId: string;
  duration: DurationRule;
  resolutions: readonly Resolution[];
  aspectRatios: readonly string[];
  maxReferenceImages: number;
  supportsFirstLastFrame: boolean;
  generatesAudio: boolean;
  supportsEdit: boolean;
  supportsExtend: boolean;
  canDisableWatermark: boolean;
  faceInput: FaceInputPolicy;
  regions: readonly string[];
  limits: { maxConcurrency: number; rpm: number; queryQps: number };
  imageInput: ImageInputLimits;
  /** 视频链接有效期（小时），超过后无法下载 */
  resultUrlTtlHours: number;
}

export interface ImageModelCapability {
  key: string;
  label: string;
  provider: string;
  modelId: string;
  textToImage: boolean;
  imageToImage: boolean;
  maxReferenceImages: number;
  /** 9:16 输出尺寸 */
  portraitSize: string;
  /** 该模型文生图得到的人脸图，是否被同账号视频模型信任（火山：Seedream 5.0 文生图 → Seedance 2.x，30 天内） */
  trustedFaceForVideoProvider?: { provider: string; days: number };
  resultUrlTtlHours: number;
}

/** 发给模型的图片 */
export type ImageInput =
  | { kind: 'base64'; mime: string; data: string }
  | { kind: 'url'; url: string }
  | { kind: 'asset'; uri: string };

export function imageInputToUrl(input: ImageInput): string {
  switch (input.kind) {
    case 'base64':
      return `data:${input.mime};base64,${input.data}`;
    case 'url':
      return input.url;
    case 'asset':
      return input.uri;
  }
}

/** 镜头图片来源（入库保存，提交时再解析为 ImageInput） */
export type ImageSourceRef = { type: 'asset'; assetId: string } | { type: 'virtual_portrait'; portraitId: string };

/** 与具体模型无关的镜头生成规格，由故事板编译得到 */
export interface ShotRenderSpec {
  shotId: string;
  durationSec: number;
  resolution: Resolution;
  aspectRatio: '9:16';
  productName: string;
  references: Array<{
    refId: string;
    kind: ReferenceKind;
    name: string;
    description: string;
    /** primary：当前使用的图；original_detail：商品原图，用于还原细节 */
    role: 'primary' | 'original_detail';
    image: ImageSourceRef | null;
  }>;
  fields: {
    purpose: string;
    subject: string;
    videoType: string;
    camera: string;
    action: string;
    scene: string;
    narration: string;
    consistency: string;
  };
  styleProfile: string;
  voiceProfile: string;
}

export interface CompiledVideoRequest {
  prompt: string;
  /** 与提示词中 @图像N 顺序一致 */
  images: ImageSourceRef[];
  params: Record<string, unknown>;
}

export interface VideoCreateRequest {
  compiled: CompiledVideoRequest;
  images: ImageInput[];
}

export type VideoTaskState = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'unknown';

export interface VideoTaskStatus {
  state: VideoTaskState;
  rawStatus: string;
  videoUrl?: string;
  usage?: unknown;
  seed?: number;
  error?: { code: string; message: string };
}

export interface VideoProvider {
  readonly capability: VideoModelCapability;
  compile(spec: ShotRenderSpec): CompiledVideoRequest;
  createTask(req: VideoCreateRequest): Promise<{ providerTaskId: string }>;
  getTask(providerTaskId: string): Promise<VideoTaskStatus>;
  cancelTask(providerTaskId: string): Promise<'cancelled' | 'not_cancellable'>;
}

export interface ImageGenerateRequest {
  prompt: string;
  /** 图生图的参考图；为空时为文生图 */
  images?: ImageInput[];
}

export interface ImageGenerateResult {
  data: Buffer;
  mime: string;
  providerUrl?: string;
  usage?: unknown;
}

export interface ImageProvider {
  readonly capability: ImageModelCapability;
  generate(req: ImageGenerateRequest): Promise<ImageGenerateResult>;
}

export type LlmPurpose =
  | 'inspect_image'
  | 'analyze_product'
  | 'storylines'
  | 'storyboard'
  | 'chat_edit'
  | 'rewrite_image_prompt'
  | 'describe_person'
  | 'compare_product_image'
  | 'qc';

export interface LlmRequest {
  purpose: LlmPurpose;
  system: string;
  user: string;
  /** data URL 或 http(s) URL */
  images?: string[];
  thinking?: boolean;
  maxTokens?: number;
  /** 重试时追加的对话 */
  followUps?: Array<{ role: 'assistant' | 'user'; content: string }>;
}

export interface LlmProvider {
  readonly modelId: string;
  complete(req: LlmRequest): Promise<{ content: string; usage?: unknown }>;
}

export interface Composer {
  /** 把合成输入渲染为 mp4 文件 */
  render(input: import('@ai-creative/shared').CompositionInput, outFile: string): Promise<void>;
}

export const LLM_PROVIDER = Symbol('LLM_PROVIDER');
export const VIDEO_PROVIDER = Symbol('VIDEO_PROVIDER');
export const IMAGE_PROVIDER = Symbol('IMAGE_PROVIDER');
export const COMPOSER = Symbol('COMPOSER');
