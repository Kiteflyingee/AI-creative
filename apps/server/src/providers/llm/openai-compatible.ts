import { ProviderError } from '../../common/errors';
import { httpJson } from '../http';
import type { LlmProvider, LlmRequest } from '../types';

interface ChatResponse {
  choices?: Array<{ message?: { content?: string | null } }>;
  usage?: unknown;
}

export interface OpenAiCompatibleOptions {
  provider: string;
  baseUrl: string;
  apiKey: string;
  modelId: string;
  /** 思考开关的写法：deepseek = thinking.type；reasoning_effort = OpenAI 写法（Gemini 兼容接口也用它）；none = 不传 */
  thinkingParam: 'deepseek' | 'reasoning_effort' | 'none';
  /** json_object = 要求 JSON 输出；none = 只靠提示词，结果仍经 zod 校验 */
  jsonMode: 'json_object' | 'none';
}

/** 不同供应商的思考参数写法 */
export function thinkingFields(param: OpenAiCompatibleOptions['thinkingParam'], thinking: boolean): Record<string, unknown> {
  switch (param) {
    case 'deepseek':
      return { thinking: { type: thinking ? 'enabled' : 'disabled' } };
    case 'reasoning_effort':
      return { reasoning_effort: thinking ? 'high' : 'low' };
    default:
      return {};
  }
}

/**
 * OpenAI 兼容的 Chat Completions 接口：DeepSeek 官方 API、火山方舟托管的 DeepSeek，
 * 以及其他兼容接口（地址、密钥、模型、思考参数写法都可配置）。
 * 图片以 image_url（data URL 或 http URL）传入。
 */
export class OpenAiCompatibleLlm implements LlmProvider {
  constructor(private readonly opts: OpenAiCompatibleOptions) {}

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
        ...(this.opts.jsonMode === 'json_object' ? { response_format: { type: 'json_object' } } : {}),
        ...thinkingFields(this.opts.thinkingParam, Boolean(req.thinking)),
        max_tokens: req.maxTokens ?? 8000,
      },
      timeoutMs: req.thinking ? 300_000 : 180_000,
    });
    const content = res?.choices?.[0]?.message?.content;
    if (!content) throw new ProviderError(this.opts.provider, 'EMPTY', '大模型没有返回内容', true);
    return { content, usage: res.usage };
  }
}
