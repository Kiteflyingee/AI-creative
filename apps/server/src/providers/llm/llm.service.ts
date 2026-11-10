import { Inject, Injectable, Logger } from '@nestjs/common';
import type { z, ZodTypeAny } from 'zod';
import { AppError } from '../../common/errors';
import { errorMessage } from '../../common/util';
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
    for (let attempt = 0; attempt <= retries; attempt++) {
      let content: string;
      try {
        ({ content } = await this.provider.complete({ ...req, followUps: [...followUps] }));
      } catch (err) {
        this.logger.warn(`${req.purpose} 调用失败：${errorMessage(err)}`);
        throw new AppError('LLM_FAILED', `AI 服务暂时不可用：${errorMessage(err)}`, 502);
      }
      let problem: string | null = null;
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
      followUps.push(
        { role: 'assistant', content: content.slice(0, 20000) },
        { role: 'user', content: `上面的输出不符合要求：${problem}。请修正后重新输出完整 JSON，不要输出其他内容。` },
      );
    }
    throw new AppError('LLM_INVALID_OUTPUT', `AI 输出不符合要求，请重试（${lastError}）`, 502);
  }
}
