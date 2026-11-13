import { ProviderError } from '../../common/errors';
import { getEnv } from '../../config/env';
import { OpenAiCompatibleLlm } from './openai-compatible';
import { VertexLlm } from './vertex-llm';

/** 显式创建供应商对象，禁止传模型字符串触发 AI SDK 默认网关。 */
export function createLlmAdapter() {
  const env = getEnv();
  if (env.LLM_PROVIDER === 'vertex') return new VertexLlm();
  const opts = env.LLM_PROVIDER === 'deepseek'
    ? { provider: 'deepseek', baseUrl: env.DEEPSEEK_BASE_URL, apiKey: env.DEEPSEEK_API_KEY, modelId: env.DEEPSEEK_MODEL, thinkingParam: 'deepseek' as const }
    : env.LLM_PROVIDER === 'ark'
      ? { provider: 'volcengine-ark', baseUrl: env.ARK_BASE_URL, apiKey: env.ARK_API_KEY, modelId: env.ARK_LLM_MODEL, thinkingParam: 'deepseek' as const }
      : { provider: 'openai-compatible', baseUrl: env.LLM_BASE_URL, apiKey: env.LLM_API_KEY, modelId: env.LLM_MODEL, thinkingParam: env.LLM_THINKING_PARAM };
  if (!opts.baseUrl) throw new ProviderError(opts.provider, 'BAD_CONFIG', '请配置 LLM_BASE_URL', false);
  return new OpenAiCompatibleLlm({ ...opts, jsonMode: env.LLM_JSON_MODE });
}
