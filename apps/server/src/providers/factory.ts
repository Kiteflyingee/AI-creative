import { ProviderError } from '../common/errors';
import { SeedreamProvider } from './image/seedream';
import { VertexImageProvider } from './image/vertex-image';
import type { ImageModelCapability, ImageProvider, ProviderFactory, VideoModelCapability, VideoProvider } from './types';
import { SeedanceProvider } from './video/seedance';
import { VertexOmniProvider } from './video/vertex-omni';

/** 只按项目绑定的供应商创建直连适配器，不跨供应商兜底。 */
export function createVideoAdapter(cap: VideoModelCapability): VideoProvider {
  switch (cap.provider) {
    case 'google-vertex': return new VertexOmniProvider(cap);
    case 'volcengine-ark': return new SeedanceProvider(cap);
    default: throw new ProviderError(cap.provider, 'NOT_SUPPORTED', '未实现该视频供应商', false);
  }
}

export function createImageAdapter(cap: ImageModelCapability): ImageProvider {
  switch (cap.provider) {
    case 'google-vertex': return new VertexImageProvider(cap);
    case 'volcengine-ark': return new SeedreamProvider(cap);
    default: throw new ProviderError(cap.provider, 'NOT_SUPPORTED', '未实现该图片供应商', false);
  }
}

export const realProviderFactory: ProviderFactory = { video: createVideoAdapter, image: createImageAdapter };
