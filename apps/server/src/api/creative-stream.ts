import { Logger } from '@nestjs/common';
import type { CreativeStreamEvent, ReportCreativeProgress } from '@ai-creative/shared';
import type { Response } from 'express';
import { AppError } from '../common/errors';

/** 一个 POST 对应一次生成。断线只停止推送，不取消或重发已进行的模型请求。 */
export async function streamCreative(res: Response, work: (report: ReportCreativeProgress) => Promise<unknown>) {
  res.status(200).set({ 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  const send = (event: CreativeStreamEvent) => {
    if (!res.destroyed && !res.writableEnded) res.write(`${JSON.stringify(event)}\n`);
  };
  const heartbeat = setInterval(() => {
    if (!res.destroyed && !res.writableEnded) res.write('\n');
  }, 15000);
  res.once('close', () => clearInterval(heartbeat));
  try {
    await work((progress) => send({ type: 'progress', progress }));
    send({ type: 'done' });
  } catch (err) {
    if (!(err instanceof AppError)) new Logger('CreativeStream').error('创作请求发生内部错误');
    send({ type: 'error', status: err instanceof AppError ? err.getStatus() : 500, code: err instanceof AppError ? err.code : 'INTERNAL', message: err instanceof AppError ? err.message : '服务器出错了，请稍后查看最新结果' });
  } finally {
    clearInterval(heartbeat);
    res.end();
  }
}
