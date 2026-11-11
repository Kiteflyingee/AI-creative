import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { defaultModels, imageCapability, videoCapability } from './registry';
import { PROVIDER_FACTORY, type ImageProvider, type ProviderFactory, type VideoProvider } from './types';

/**
 * 多供应商并存（D-45）：按能力登记表的键名取适配器，每个键名只创建一次。
 * 业务代码不直接引用某一家供应商；项目用哪一组模型记录在项目上（D-46）。
 */
@Injectable()
export class ModelHub implements OnModuleInit {
  private readonly logger = new Logger(ModelHub.name);
  private readonly videos = new Map<string, VideoProvider>();
  private readonly images = new Map<string, ImageProvider>();

  constructor(@Inject(PROVIDER_FACTORY) private readonly factory: ProviderFactory) {}

  /** 启动时检查配置的默认组合是否已登记，配置错误时直接启动失败 */
  onModuleInit() {
    const { videoModel, imageModel } = defaultModels();
    this.logger.log(`新建项目使用的模型组合：视频 ${videoModel}，图片 ${imageModel}`);
  }

  video(key: string): VideoProvider {
    let provider = this.videos.get(key);
    if (!provider) {
      provider = this.factory.video(videoCapability(key));
      this.videos.set(key, provider);
    }
    return provider;
  }

  image(key: string): ImageProvider {
    let provider = this.images.get(key);
    if (!provider) {
      provider = this.factory.image(imageCapability(key));
      this.images.set(key, provider);
    }
    return provider;
  }
}
