import { ProviderError } from '../../common/errors';
import { GEMINI_PROVIDER, geminiBase, geminiCall, modelOutputs, outputText, toGeminiImagePart, type InteractionResponse } from '../gemini';
import type { ImageGenerateRequest, ImageGenerateResult, ImageModelCapability, ImageProvider } from '../types';

/**
 * Nano Banana（Gemini 图片模型）适配器：POST /interactions，同步返回 Base64 图片。
 * 文档：https://ai.google.dev/gemini-api/docs/image-generation
 * 只要图片输出（response_format.type=image），9:16，尺寸档位按登记表（1K = 768×1376）。
 */
export class NanoBananaProvider implements ImageProvider {
  constructor(readonly capability: ImageModelCapability) {}

  async buildBody(req: ImageGenerateRequest): Promise<Record<string, unknown>> {
    const images = (req.images ?? []).slice(0, this.capability.maxReferenceImages);
    const parts = await Promise.all(images.map((img) => toGeminiImagePart(img)));
    return {
      model: this.capability.modelId,
      input: [{ type: 'text', text: req.prompt }, ...parts],
      response_format: {
        type: 'image',
        aspect_ratio: '9:16',
        ...(this.capability.imageSize ? { image_size: this.capability.imageSize } : {}),
      },
    };
  }

  async generate(req: ImageGenerateRequest): Promise<ImageGenerateResult> {
    const res = await geminiCall<InteractionResponse>({
      method: 'POST',
      url: `${geminiBase()}/interactions`,
      body: await this.buildBody(req),
      timeoutMs: 180_000,
    });
    return parseImageInteraction(res);
  }
}

export function parseImageInteraction(res: InteractionResponse): ImageGenerateResult {
  const image = [...modelOutputs(res)].reverse().find((c) => c.type === 'image' && c.data);
  if (!image?.data) {
    const text = outputText(res).slice(0, 200);
    throw new ProviderError(GEMINI_PROVIDER, 'NO_IMAGE', `图片模型没有返回图片${text ? `：${text}` : ''}`, false);
  }
  return { data: Buffer.from(image.data, 'base64'), mime: image.mime_type ?? 'image/png', usage: res.usage };
}
