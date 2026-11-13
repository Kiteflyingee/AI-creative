import { HttpException, HttpStatus } from '@nestjs/common';

/** 面向商家的错误：message 是可直接展示的中文说明 */
export class AppError extends HttpException {
  constructor(
    public readonly code: string,
    message: string,
    status: HttpStatus = HttpStatus.BAD_REQUEST,
    public readonly details?: unknown,
  ) {
    super({ code, message, details }, status);
  }
}

export const notFound = (what = '资源') => new AppError('NOT_FOUND', `${what}不存在或无权访问`, HttpStatus.NOT_FOUND);
export const conflict = (code: string, message: string, details?: unknown) =>
  new AppError(code, message, HttpStatus.CONFLICT, details);
export const badRequest = (code: string, message: string, details?: unknown) =>
  new AppError(code, message, HttpStatus.BAD_REQUEST, details);

/** 外部供应商错误（模型接口） */
export class ProviderError extends Error {
  constructor(
    public readonly provider: string,
    public readonly code: string,
    message: string,
    /** 可重试：限流、网络、5xx */
    public readonly retryable: boolean,
    public readonly httpStatus?: number,
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}
