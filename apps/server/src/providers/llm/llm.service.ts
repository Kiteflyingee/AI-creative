import { Inject, Injectable, Logger } from '@nestjs/common';
import type { z, ZodTypeAny } from 'zod';
import type { ReportCreativeProgress } from '@ai-creative/shared';
import { AppError, ProviderError } from '../../common/errors';
import { errorMessage, sleep } from '../../common/util';
import { LLM_PROVIDER, type LlmProvider, type LlmRequest } from '../types';

export function extractJson(content: string): unknown {
  const trimmed = content.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)```$/i.exec(trimmed);
  const body = fenced ? fenced[1]! : trimmed;
  return JSON.parse(body);
}

export interface JsonCallOptions<T> {
  /** 业务校验（如引用了不存在的卖点）；返回错误说明时会带着说明重试 */
  validate?: (data: T) => string | null;
  retries?: number;
  onProgress?: ReportCreativeProgress;
}

/**
 * 大模型调用：要求 JSON 输出，经 zod 校验后才使用（模型输出只当数据，不执行）。
 * 校验失败时把错误说明发回给模型重试，次数有上限。
 */
@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);

  constructor(@Inject(LLM_PROVIDER) private readonly provider: LlmProvider) {}

  get modelId() {
    return this.provider.modelId;
  }

  async completeJson<S extends ZodTypeAny>(
    req: LlmRequest,
    schema: S,
    opts: JsonCallOptions<z.output<S>> = {},
  ): Promise<z.output<S>> {
    const retries = opts.retries ?? 2;
    const followUps = [...(req.followUps ?? [])];
    let lastError = '';
    // 整个 JSON 调用共用退避预算，格式修正不会重置它；SDK 自身仍禁止隐式重试。
    let rateLimitRetries = 0;
    for (let attempt = 0; attempt <= retries; attempt++) {
      let content: string;
      for (;;) {
        try {
          opts.onProgress?.({ phase: 'generating', attempt: attempt + 1 });
          ({ content } = await this.provider.complete({ ...req, followUps: [...followUps] }));
          break;
        } catch (err) {
          if (err instanceof ProviderError && err.httpStatus === 429) {
            const delay = Math.max(5000 * 2 ** rateLimitRetries + Math.floor(Math.random() * 1000), err.retryAfterMs ?? 0);
            // Retry-After 过长时直接提示稍后重试，不提前重发，也不一直占着页面请求。
            if (err.retryable && rateLimitRetries < 2 && delay <= 30000) {
              rateLimitRetries++;
              this.logger.warn(`${req.purpose} 请求受限（429），${delay}ms 后重试（${rateLimitRetries}/2）`);
              opts.onProgress?.({ phase: 'waiting', attempt: attempt + 1, retryAfterMs: delay });
              await sleep(delay);
              continue;
            }
            this.logger.warn(`${req.purpose} 请求受限（429），已停止自动重试`);
            throw new AppError('LLM_RATE_LIMITED', 'AI 服务当前请求受限或繁忙，请稍后重试', 429, {
              retryAfterSeconds: Math.ceil((err.retryAfterMs ?? 30000) / 1000),
            });
          }
          this.logger.warn(`${req.purpose} 调用失败：${errorMessage(err)}`);
          if (err instanceof ProviderError && ['NETWORK', 'TIMEOUT'].includes(err.code)) {
            throw new AppError('LLM_NETWORK', err.message, 502);
          }
          throw new AppError('LLM_FAILED', `AI 服务暂时不可用：${errorMessage(err)}`, 502);
        }
      }
      let problem: string | null = null;
      opts.onProgress?.({ phase: 'validating', attempt: attempt + 1 });
      try {
        const parsed = schema.safeParse(extractJson(content));
        if (!parsed.success) {
          problem = parsed.error.issues
            .slice(0, 8)
            .map((i) => `${i.path.join('.')}: ${i.message}`)
            .join('; ');
        } else {
          problem = opts.validate?.(parsed.data as z.output<S>) ?? null;
          if (!problem) return parsed.data as z.output<S>;
        }
      } catch {
        problem = '输出不是合法的 JSON';
      }
      lastError = problem;
      this.logger.warn(`${req.purpose} 第 ${attempt + 1} 次输出不合格：${problem}`);
      if (attempt < retries) opts.onProgress?.({ phase: 'correcting', attempt: attempt + 2 });
      followUps.push(
        { role: 'assistant', content: content.slice(0, 20000) },
        { role: 'user', content: `上面的输出不符合要求：${problem}。请修正后重新输出完整 JSON，不要输出其他内容。` },
      );
    }
    throw new AppError('LLM_INVALID_OUTPUT', `AI 输出不符合要求，请重试（${lastError}）`, 502);
  }
}
