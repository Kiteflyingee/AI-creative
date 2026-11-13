import { createVertex } from '@ai-sdk/google-vertex';
import type { LanguageModel } from 'ai';
import { getEnv } from '../../config/env';
import type { LlmProvider, LlmRequest } from '../types';
import { toVertexInteractionImagePart, vertexAccessToken, vertexBase, VERTEX_PROVIDER } from '../vertex';
import { completeWithSdk, directFetch } from './ai-sdk';

/** 显式 Vertex Provider：ADC + 全局项目端点，不使用 Vercel Gateway 或 AI Studio。 */
export class VertexLlm implements LlmProvider {
  private model?: LanguageModel;
  constructor(readonly modelId = getEnv().VERTEX_LLM_MODEL) {}

  async complete(req: LlmRequest): Promise<{ content: string; usage?: unknown }> {
    if (!this.model) {
      const env = getEnv();
      const baseURL = `${vertexBase()}/publishers/google`;
      // 在 SDK 包装错误前验证 ADC，让缺少/失效的凭据给出明确的登录提示。
      await vertexAccessToken();
      const vertex = createVertex({
        apiKey: '', // 禁用 GOOGLE_VERTEX_API_KEY 隐式启用 Express 模式。
        project: env.VERTEX_PROJECT_ID,
        location: env.VERTEX_LOCATION,
        baseURL,
        headers: { 'x-goog-user-project': env.VERTEX_PROJECT_ID },
        fetch: directFetch,
      });
      this.model = vertex(this.modelId);
    }
    // 与原生 Vertex 图片/视频相同：存储链接由服务端读取，不交给模型抓取。
    const images = await Promise.all((req.images ?? []).map(async (uri) => {
      const data = /^data:(image\/[\w.+-]+);base64,([A-Za-z0-9+/=\r\n]+)$/.exec(uri);
      if (data) return uri;
      const image = await toVertexInteractionImagePart({ kind: 'url', url: uri });
      return `data:${image.mime_type};base64,${image.data}`;
    }));
    return completeWithSdk(VERTEX_PROVIDER, this.model, { ...req, images });
  }
}
