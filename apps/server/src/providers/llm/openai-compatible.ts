import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { ProviderError } from '../../common/errors';
import type { LlmProvider, LlmRequest } from '../types';
import { completeWithSdk, directFetch } from './ai-sdk';

export interface OpenAiCompatibleOptions {
  provider: string;
  baseUrl: string;
  apiKey: string;
  modelId: string;
  thinkingParam: 'deepseek' | 'reasoning_effort' | 'none';
  jsonMode: 'json_object' | 'none';
}

export function thinkingFields(param: OpenAiCompatibleOptions['thinkingParam'], thinking: boolean): Record<string, unknown> {
  switch (param) {
    case 'deepseek': return { thinking: { type: thinking ? 'enabled' : 'disabled' } };
    case 'reasoning_effort': return { reasoning_effort: thinking ? 'high' : 'low' };
    default: return {};
  }
}

/** DeepSeek、方舟托管模型及其他 OpenAI 兼容接口，使用 AI SDK 直连。 */
export class OpenAiCompatibleLlm implements LlmProvider {
  constructor(private readonly opts: OpenAiCompatibleOptions) {}

  get modelId() { return this.opts.modelId; }

  async complete(req: LlmRequest): Promise<{ content: string; usage?: unknown }> {
    if (!this.opts.apiKey) throw new ProviderError(this.opts.provider, 'MISSING_API_KEY', `${this.opts.provider} 未配置 API Key（.env）`, false);
    const url = new URL(this.opts.baseUrl);
    if (url.username || url.password || url.search || url.hash || !['http:', 'https:'].includes(url.protocol)) {
      throw new ProviderError(this.opts.provider, 'BAD_CONFIG', '大模型接口地址无效', false);
    }
    const provider = createOpenAICompatible({
      name: this.opts.provider,
      baseURL: this.opts.baseUrl.replace(/\/$/, ''),
      apiKey: this.opts.apiKey,
      fetch: directFetch,
      transformRequestBody: (body) => ({ ...body, ...thinkingFields(this.opts.thinkingParam, Boolean(req.thinking)) }),
    });
    return completeWithSdk(this.opts.provider, provider(this.modelId), req, this.opts.jsonMode === 'json_object');
  }
}
