import { getEnv } from '../config/env';
import type { ImageModelCapability, VideoModelCapability } from './types';

/**
 * 模型能力登记表（D-39）。新增模型时在这里登记能力，并实现对应的适配器。
 * 数据来源：docs/06-模型能力与约束.md（火山方舟官方文档，2026-11-10 查询）。
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
      regions: ['cn'],
      limits: { maxConcurrency: env.VIDEO_MAX_CONCURRENCY, rpm: env.VIDEO_RPM, queryQps: 20 },
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
  };
}

export function selectedVideoModel(): VideoModelCapability {
  const key = getEnv().VIDEO_MODEL;
  const cap = videoModelRegistry()[key];
  if (!cap) throw new Error(`未登记的视频模型：${key}`);
  return cap;
}

export function selectedImageModel(): ImageModelCapability {
  const key = getEnv().IMAGE_MODEL;
  const cap = imageModelRegistry()[key];
  if (!cap) throw new Error(`未登记的图片模型：${key}`);
  return cap;
}
