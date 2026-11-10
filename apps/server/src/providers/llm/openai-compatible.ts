import { ProviderError } from '../../common/errors';
import { httpJson } from '../http';
import type { LlmProvider, LlmRequest } from '../types';

interface ChatResponse {
  choices?: Array<{ message?: { content?: string | null } }>;
  usage?: unknown;
}

/**
 * OpenAI 兼容的 Chat Completions 接口：DeepSeek 官方 API 与火山方舟托管的 DeepSeek 都用这个格式。
 * 图片以 image_url（data URL 或 http URL）传入；输出要求 json_object。
 */
export class OpenAiCompatibleLlm implements LlmProvider {
  constructor(
    private readonly opts: { provider: string; baseUrl: string; apiKey: string; modelId: string },
  ) {}

  get modelId() {
    return this.opts.modelId;
  }

  async complete(req: LlmRequest): Promise<{ content: string; usage?: unknown }> {
    const userContent =
      req.images && req.images.length > 0
        ? [
            { type: 'text', text: req.user },
            ...req.images.map((url) => ({ type: 'image_url', image_url: { url } })),
          ]
        : req.user;
    const messages: Array<{ role: string; content: unknown }> = [
      { role: 'system', content: req.system },
      { role: 'user', content: userContent },
      ...(req.followUps ?? []),
    ];
    const res = await httpJson<ChatResponse>({
      provider: this.opts.provider,
      method: 'POST',
      url: `${this.opts.baseUrl.replace(/\/$/, '')}/chat/completions`,
      apiKey: this.opts.apiKey,
      body: {
        model: this.opts.modelId,
        messages,
        response_format: { type: 'json_object' },
        thinking: { type: req.thinking ? 'enabled' : 'disabled' },
        max_tokens: req.maxTokens ?? 8000,
      },
      timeoutMs: req.thinking ? 300_000 : 180_000,
    });
    const content = res?.choices?.[0]?.message?.content;
    if (!content) throw new ProviderError(this.opts.provider, 'EMPTY', '大模型没有返回内容', true);
    return { content, usage: res.usage };
  }
}
