import { APICallError, generateText, NoObjectGeneratedError, Output, type LanguageModel } from 'ai';
import { ProviderError } from '../../common/errors';
import type { LlmRequest } from '../types';

/** SDK 只做协议转换；重试仍由业务控制，鉴权请求不跟随重定向。 */
export const directFetch: typeof fetch = (input, init) => fetch(input, { ...init, redirect: 'error' });

function retryAfterMs(value: string | undefined): number | undefined {
  if (!value?.trim()) return undefined;
  const seconds = Number(value);
  const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - Date.now();
  return Number.isFinite(delay) && delay >= 0 ? delay : undefined;
}

export async function completeWithSdk(
  provider: string,
  model: LanguageModel,
  req: LlmRequest,
  jsonMode = true,
): Promise<{ content: string; usage?: unknown }> {
  try {
    const result = await generateText({
      model,
      system: req.system,
      messages: [
        { role: 'user', content: [{ type: 'text', text: req.user }, ...(req.images ?? []).map((image) => ({ type: 'image' as const, image: new URL(image) }))] },
        ...(req.followUps ?? []),
      ],
      ...(jsonMode ? { output: Output.json() } : {}),
      maxOutputTokens: req.maxTokens ?? 8000,
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(req.thinking ? 300_000 : 180_000),
    });
    if (!result.text.trim()) throw new ProviderError(provider, 'EMPTY', '大模型没有返回内容', false);
    return { content: result.text, usage: result.usage };
  } catch (err) {
    // 不合法 JSON 交回 LlmService，保留原有 zod / 业务校验及修正对话。
    if (NoObjectGeneratedError.isInstance(err) && err.text?.trim()) return { content: err.text, usage: err.usage };
    if (err instanceof ProviderError) throw err;
    // SDK 错误可能带请求体、鉴权头和服务账号信息，不对外传递原始错误。
    if (APICallError.isInstance(err)) {
      const status = err.statusCode;
      if (status === undefined) throw new ProviderError(provider, 'NETWORK', 'AI 服务网络连接中断，请稍后重试', true);
      if (status === 429) throw new ProviderError(provider, 'HTTP_429', 'AI 服务请求受限，正在等待恢复', true, status, retryAfterMs(err.responseHeaders?.['retry-after']));
      throw new ProviderError(provider, `HTTP_${status ?? 'UNKNOWN'}`, `${provider} 请求失败${status ? `（HTTP ${status}）` : ''}`, status === 429 || (status !== undefined && status >= 500), status);
    }
    if (err instanceof Error && ['TimeoutError', 'AbortError'].includes(err.name)) {
      throw new ProviderError(provider, 'TIMEOUT', 'AI 服务响应超时，请稍后重试', true);
    }
    throw new ProviderError(provider, 'SDK_FAILED', `${provider} 调用失败，请检查供应商配置、凭据和网络`, false);
  }
}
