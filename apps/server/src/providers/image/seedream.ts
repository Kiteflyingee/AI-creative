import { getEnv } from '../../config/env';
import { ProviderError } from '../../common/errors';
import { httpDownload, httpJson } from '../http';
import {
  imageInputToUrl,
  type ImageGenerateRequest,
  type ImageGenerateResult,
  type ImageModelCapability,
  type ImageProvider,
} from '../types';

interface ArkImageResponse {
  data?: Array<{ url?: string; b64_json?: string }>;
  usage?: unknown;
  error?: { code?: string; message?: string };
}

/** 火山方舟 Seedream 5.0 适配器（POST /images/generations） */
export class SeedreamProvider implements ImageProvider {
  constructor(readonly capability: ImageModelCapability) {}

  async generate(req: ImageGenerateRequest): Promise<ImageGenerateResult> {
    const env = getEnv();
    const images = (req.images ?? []).slice(0, this.capability.maxReferenceImages).map(imageInputToUrl);
    const body: Record<string, unknown> = {
      model: this.capability.modelId,
      prompt: req.prompt,
      size: this.capability.portraitSize,
      output_format: 'jpeg',
      response_format: 'url',
      watermark: false,
    };
    if (images.length === 1) body.image = images[0];
    else if (images.length > 1) body.image = images;

    const res = await httpJson<ArkImageResponse>({
      provider: 'seedream',
      method: 'POST',
      url: `${env.ARK_BASE_URL.replace(/\/$/, '')}/images/generations`,
      apiKey: env.ARK_API_KEY,
      body,
      timeoutMs: 180_000,
    });
    const first = res?.data?.[0];
    if (first?.b64_json) {
      return { data: Buffer.from(first.b64_json, 'base64'), mime: 'image/jpeg', usage: res.usage };
    }
    if (!first?.url) {
      throw new ProviderError('seedream', res?.error?.code ?? 'BAD_RESPONSE', res?.error?.message ?? 'Seedream 未返回图片', false);
    }
    // 原样保存模型产物（不压缩、不剪辑），以便 Seedance 信任其中的人脸
    const data = await httpDownload(first.url, 120_000);
    return { data, mime: 'image/jpeg', providerUrl: first.url, usage: res.usage };
  }
}
