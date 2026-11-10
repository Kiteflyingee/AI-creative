import { PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';
import { badRequest } from './errors';

/** 用 zod 校验请求体 */
export class ZodPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      const message = result.error.issues
        .slice(0, 5)
        .map((i) => `${i.path.join('.') || '请求'}：${i.message}`)
        .join('；');
      throw badRequest('INVALID_INPUT', `输入不合法：${message}`);
    }
    return result.data;
  }
}
