import { getEnv } from '../config/env';
import { badRequest } from '../common/errors';
import type { ImageModelCapability, VideoModelCapability } from './types';

/**
 * 模型能力登记表（D-39）。新增模型时在这里登记能力，并在 providers/factory.ts 里登记适配器。
 * 数据来源：docs/06-模型能力与约束.md、docs/08-Vertex-AI接入.md（火山方舟、Google Cloud 官方文档）。
 */
export function videoModelRegistry(): Record<string, VideoModelCapability> {
  const env = getEnv();
  return {
    'seedance-2.5': {
      key: 'seedance-2.5',
      label: 'Seedance 2.5',
      provider: 'volcengine-ark',
      modelId: env.SEEDANCE_MODEL_ID,
      // 官方：4–30 秒整数。按 Kickart 片段化生成的经验，单镜头建议 5 秒左右
      duration: { min: 4, max: 30, recommended: 5 },
      resolutions: ['480p', '720p', '1080p'],
      aspectRatios: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'],
      maxReferenceImages: 30,
      supportsFirstLastFrame: true,
      generatesAudio: true,
      supportsEdit: true,
      supportsExtend: true,
      canDisableWatermark: true,
      faceInput: 'asset_or_trusted',
      virtualPortraits: true,
      // 国内走火山方舟；海外走 BytePlus ModelArk（改 ARK_BASE_URL 与模型 ID，未实测）
      regions: ['cn', 'ap-southeast'],
      limits: { maxConcurrency: env.ARK_VIDEO_MAX_CONCURRENCY, rpm: env.ARK_VIDEO_RPM, queryQps: 20 },
      imageInput: {
        formats: ['jpeg', 'png', 'webp', 'bmp', 'tiff', 'gif'],
        minSide: 300,
        maxSide: 6000,
        minRatio: 0.4,
        maxRatio: 2.5,
        maxBytes: 30 * 1024 * 1024,
      },
      resultUrlTtlHours: 24,
    },
    'vertex-gemini-omni-1.2-flash': {
      key: 'vertex-gemini-omni-1.2-flash',
      label: 'Gemini Omni 1.2 Flash',
      provider: 'google-vertex',
      modelId: env.VERTEX_OMNI_MODEL_ID,
      // 官方：3–15 秒（默认 10 秒）；与 Seedance 一样按单镜头 5 秒左右规划
      duration: { min: 3, max: 15, recommended: 5 },
      // 官方另有 360p 与 4K；按 D-07 只开放 720p / 1080p（没有 480p）
      resolutions: ['720p', '1080p'],
      aspectRatios: ['16:9', '9:16'],
      // 官方：最多 6 张参考图，每个角色最多 3 张、最多 2 个角色
      maxReferenceImages: 6,
      supportsFirstLastFrame: true,
      generatesAudio: true,
      supportsEdit: true,
      supportsExtend: true,
      // 没有可见水印（只有不可见的 SynthID），无需关闭
      canDisableWatermark: true,
      // 官方：不接受含“某些可识别真人”的图片；商家上传的真人脸图一律不发送（D-28）
      faceInput: 'reject',
      virtualPortraits: false,
      regions: ['global'],
      limits: { maxConcurrency: env.VERTEX_VIDEO_MAX_CONCURRENCY, rpm: env.VERTEX_VIDEO_RPM, queryQps: 5 },
      // 官方没有写明参考图尺寸限制，按保守值登记；发送前统一转成 JPEG（最长边 2048）
      imageInput: {
        formats: ['jpeg', 'png', 'webp'],
        minSide: 300,
        maxSide: 6000,
        minRatio: 0.4,
        maxRatio: 2.5,
        maxBytes: 30 * 1024 * 1024,
      },
      // Vertex AI 存储/后台 interaction 最多保留 7 天；成功后立即转存并删除
      resultUrlTtlHours: 7 * 24,
    },
  };
}

export function imageModelRegistry(): Record<string, ImageModelCapability> {
  const env = getEnv();
  return {
    'seedream-5.0-pro': {
      key: 'seedream-5.0-pro',
      label: 'Seedream 5.0 pro',
      provider: 'volcengine-ark',
      modelId: env.SEEDREAM_MODEL_ID,
      textToImage: true,
      imageToImage: true,
      maxReferenceImages: 10,
      // 1.5K 档 9:16 的官方参考尺寸
      portraitSize: '1152x2048',
      trustedFaceForVideoProvider: { provider: 'volcengine-ark', days: 30 },
      resultUrlTtlHours: 24,
    },
    'vertex-nano-banana-2.1': {
      key: 'vertex-nano-banana-2.1',
      label: 'Nano Banana 2.1',
      provider: 'google-vertex',
      modelId: env.VERTEX_IMAGE_MODEL_ID,
      textToImage: true,
      imageToImage: true,
      // 官方：最多 14 张输入图
      maxReferenceImages: 14,
      // 1K 档 9:16 的官方尺寸
      portraitSize: '768x1376',
      imageSize: '1K',
      // 结果直接以 Base64 返回，没有链接
      resultUrlTtlHours: 0,
    },
  };
}

export function videoCapability(key: string): VideoModelCapability {
  if (key === 'gemini-omni-1.2-flash') {
    throw badRequest('MODEL_RETIRED', '此项目使用的 Gemini API 直连入口已停用，请新建 Vertex AI 项目');
  }
  const cap = videoModelRegistry()[key];
  if (!cap) throw new Error(`未登记的视频模型：${key}`);
  return cap;
}

export function imageCapability(key: string): ImageModelCapability {
  if (key === 'nano-banana-2.1') {
    throw badRequest('MODEL_RETIRED', '此项目使用的 Gemini API 直连入口已停用，请新建 Vertex AI 项目');
  }
  const cap = imageModelRegistry()[key];
  if (!cap) throw new Error(`未登记的图片模型：${key}`);
  return cap;
}

/** 按模型 ID 反查图片模型（用于判断 AI 人物图由哪个模型生成） */
export function imageCapabilityByModelId(modelId: string | null | undefined): ImageModelCapability | undefined {
  if (!modelId) return undefined;
  return Object.values(imageModelRegistry()).find((c) => c.modelId === modelId);
}

/** 当前配置的模型组合；新建项目时使用 */
export function defaultModels(): { videoModel: string; imageModel: string } {
  const env = getEnv();
  return { videoModel: videoCapability(env.VIDEO_MODEL).key, imageModel: imageCapability(env.IMAGE_MODEL).key };
}
