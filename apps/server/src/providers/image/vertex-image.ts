import { ProviderError } from '../../common/errors';
import type { ImageGenerateRequest, ImageGenerateResult, ImageModelCapability, ImageProvider } from '../types';
import { toVertexImagePart, vertexCall, vertexModelUrl, VERTEX_PROVIDER, type VertexContentResponse } from '../vertex';

/** Vertex AI 原生 generateContent：文本生成图片与参考图编辑，结果原样转存。 */
export class VertexImageProvider implements ImageProvider {
  constructor(readonly capability: ImageModelCapability) {}

  async generate(req: ImageGenerateRequest): Promise<ImageGenerateResult> {
    if ((req.images?.length ?? 0) > this.capability.maxReferenceImages) throw new ProviderError(VERTEX_PROVIDER, 'TOO_MANY_IMAGES', '参考图数量超过图片模型能力限制', false);
    const parts = await Promise.all((req.images ?? []).map(toVertexImagePart));
    const res = await vertexCall<VertexContentResponse>({
      method: 'POST',
      url: vertexModelUrl(this.capability.modelId),
      body: {
        contents: [{ role: 'user', parts: [{ text: req.prompt }, ...parts] }],
        generationConfig: {
          responseModalities: ['TEXT', 'IMAGE'],
          imageConfig: { aspectRatio: '9:16', ...(this.capability.imageSize ? { imageSize: this.capability.imageSize } : {}) },
        },
      },
      timeoutMs: 180_000,
    });
    const image = res?.candidates?.[0]?.content?.parts?.find((part) => !part.thought && part.inlineData?.mimeType.startsWith('image/') && part.inlineData.data)?.inlineData;
    if (!image) throw new ProviderError(VERTEX_PROVIDER, 'NO_IMAGE', 'Vertex AI 图片模型没有返回图片，请检查模型权限、输入内容和安全过滤结果', false);
    const data = Buffer.from(image.data, 'base64');
    if (!data.length) throw new ProviderError(VERTEX_PROVIDER, 'NO_IMAGE', 'Vertex AI 返回的图片为空', false);
    return { data, mime: image.mimeType, usage: res.usageMetadata };
  }
}
