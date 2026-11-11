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
  /** 是否支持供应商预置的虚拟人像（火山 asset://）；不支持时前端不显示“换虚拟人像” */
  virtualPortraits: boolean;
  regions: readonly string[];
  /** 并发与每分钟请求数按供应商账号计算：同一 provider 的模型共用这一组限制 */
  limits: { maxConcurrency: number; rpm: number; queryQps: number };
  imageInput: ImageInputLimits;
  /** 结果在供应商侧保留的时间（小时），超过后无法下载 */
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
  /** 按档位指定尺寸的模型（如 Nano Banana 的 1K/2K/4K） */
  imageSize?: string;
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
  /** 与提示词中图片编号的顺序一致 */
  images: ImageSourceRef[];
  /** 镜头时长（秒），各供应商写进请求的格式不同，这里统一记录 */
  durationSec: number;
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
  /**
   * 成功时的结果位置，交给 downloadResult 下载：Seedance 是视频链接（24 小时有效）；
   * Gemini 是 interaction 引用或文件地址。只在服务端使用，不下发前端
   */
  resultRef?: string;
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
  /** 下载生成好的视频 */
  downloadResult(resultRef: string, providerTaskId: string): Promise<Buffer>;
  /** 转存成功后删除供应商侧保存的请求与结果（可选，失败不影响片段） */
  cleanup?(providerTaskId: string): Promise<void>;
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

/** 按能力登记表的一项创建适配器（测试中替换为假供应商） */
export interface ProviderFactory {
  video(cap: VideoModelCapability): VideoProvider;
  image(cap: ImageModelCapability): ImageProvider;
}

export const LLM_PROVIDER = Symbol('LLM_PROVIDER');
export const PROVIDER_FACTORY = Symbol('PROVIDER_FACTORY');
export const COMPOSER = Symbol('COMPOSER');
