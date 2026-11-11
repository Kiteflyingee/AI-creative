import { NanoBananaProvider } from './image/nano-banana';
import { SeedreamProvider } from './image/seedream';
import type { ImageModelCapability, ImageProvider, ProviderFactory, VideoModelCapability, VideoProvider } from './types';
import { GeminiOmniProvider } from './video/gemini-omni';
import { SeedanceProvider } from './video/seedance';

/** 按能力登记表中的 provider 创建真实适配器；新增供应商时在这里登记 */
export function createVideoAdapter(cap: VideoModelCapability): VideoProvider {
  switch (cap.provider) {
    case 'volcengine-ark':
      return new SeedanceProvider(cap);
    case 'google-gemini':
      return new GeminiOmniProvider(cap);
    default:
      throw new Error(`视频模型 ${cap.key} 还没有实现适配器`);
  }
}

export function createImageAdapter(cap: ImageModelCapability): ImageProvider {
  switch (cap.provider) {
    case 'volcengine-ark':
      return new SeedreamProvider(cap);
    case 'google-gemini':
      return new NanoBananaProvider(cap);
    default:
      throw new Error(`图片模型 ${cap.key} 还没有实现适配器`);
  }
}

export const realProviderFactory: ProviderFactory = { video: createVideoAdapter, image: createImageAdapter };
