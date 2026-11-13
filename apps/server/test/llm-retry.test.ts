import { Logger } from '@nestjs/common';
import { z } from 'zod';
import { AppError, ProviderError } from '../src/common/errors';
import * as util from '../src/common/util';
import { LlmService } from '../src/providers/llm/llm.service';
import type { LlmProvider } from '../src/providers/types';

const req = { purpose: 'storyboard' as const, system: 's', user: 'u' };
const schema = z.object({ ok: z.literal(true) });
const limited = (retryAfterMs?: number) => new ProviderError('google-vertex', 'HTTP_429', 'limited', true, 429, retryAfterMs);
let complete: jest.MockedFunction<LlmProvider['complete']>;
let wait: jest.SpyInstance;
let service: LlmService;

beforeEach(() => {
  complete = jest.fn();
  wait = jest.spyOn(util, 'sleep').mockResolvedValue(undefined);
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  service = new LlmService({ modelId: 'test', complete });
});
afterEach(() => jest.restoreAllMocks());

it('429 指数退避后成功：最多重试两次，保留同一请求', async () => {
  complete.mockRejectedValueOnce(limited()).mockRejectedValueOnce(limited()).mockResolvedValueOnce({ content: '{"ok":true}' });
  expect(await service.completeJson(req, schema)).toEqual({ ok: true });
  expect(complete).toHaveBeenCalledTimes(3);
  expect(wait).toHaveBeenCalledTimes(2);
  expect(wait.mock.calls[0][0]).toBeGreaterThanOrEqual(5000);
  expect(wait.mock.calls[0][0]).toBeLessThan(6000);
  expect(wait.mock.calls[1][0]).toBeGreaterThanOrEqual(10000);
  expect(wait.mock.calls[1][0]).toBeLessThan(11000);
  expect(complete.mock.calls[0][0]).toEqual(complete.mock.calls[2][0]);
});

it('进度来自真实调用与校验：429、修正分别上报，不泄露模型原文', async () => {
  complete.mockRejectedValueOnce(limited(20000)).mockResolvedValueOnce({ content: 'SECRET_INVALID_JSON' }).mockResolvedValueOnce({ content: '{"ok":true}' });
  const onProgress = jest.fn();
  await service.completeJson(req, schema, { onProgress });
  expect(onProgress.mock.calls.map(([event]) => event.phase)).toEqual(['generating', 'waiting', 'generating', 'validating', 'correcting', 'generating', 'validating']);
  expect(onProgress.mock.calls[1][0]).toMatchObject({ retryAfterMs: 20000 });
  expect(JSON.stringify(onProgress.mock.calls)).not.toContain('SECRET');
});

it('持续 429 在三次请求后停止，给出明确限流错误', async () => {
  complete.mockRejectedValue(limited());
  const err = await service.completeJson(req, schema).catch((e: unknown) => e);
  expect(err).toMatchObject({ code: 'LLM_RATE_LIMITED' });
  if (!(err instanceof AppError)) throw err;
  expect(err.getStatus()).toBe(429);
  expect(err.getResponse()).toMatchObject({ details: { retryAfterSeconds: 30 } });
  expect(complete).toHaveBeenCalledTimes(3);
});

it('尊重 Retry-After；等待要求过长时直接提示，不提前重发', async () => {
  complete.mockRejectedValueOnce(limited(20000)).mockResolvedValueOnce({ content: '{"ok":true}' });
  await service.completeJson(req, schema);
  expect(wait).toHaveBeenCalledWith(20000);
  complete.mockClear().mockRejectedValue(limited(60000));
  wait.mockClear();
  const err = await service.completeJson(req, schema).catch((e: unknown) => e);
  if (!(err instanceof AppError)) throw err;
  expect(err.getResponse()).toMatchObject({ code: 'LLM_RATE_LIMITED', details: { retryAfterSeconds: 60 } });
  expect(complete).toHaveBeenCalledTimes(1);
  expect(wait).not.toHaveBeenCalled();
});

it('JSON 修正不会重置 429 重试预算', async () => {
  complete.mockRejectedValueOnce(limited()).mockResolvedValueOnce({ content: 'not JSON' })
    .mockRejectedValueOnce(limited()).mockResolvedValueOnce({ content: '{"ok":false}' })
    .mockRejectedValue(limited());
  await expect(service.completeJson(req, schema)).rejects.toMatchObject({ code: 'LLM_RATE_LIMITED' });
  expect(complete).toHaveBeenCalledTimes(5);
  expect(wait).toHaveBeenCalledTimes(2);
  expect(complete.mock.calls[2][0].followUps).toHaveLength(2);
});

it.each([
  ['NETWORK', undefined, 'LLM_NETWORK'],
  ['TIMEOUT', undefined, 'LLM_NETWORK'],
  ['AUTH_FAILED', undefined, 'LLM_FAILED'],
  ['HTTP_403', 403, 'LLM_FAILED'],
  ['HTTP_503', 503, 'LLM_FAILED'],
])('%s 不自动重复请求', async (code, status, resultCode) => {
  complete.mockRejectedValue(new ProviderError('google-vertex', code, '调用失败', true, status));
  await expect(service.completeJson(req, schema)).rejects.toMatchObject({ code: resultCode });
  expect(complete).toHaveBeenCalledTimes(1);
  expect(wait).not.toHaveBeenCalled();
});
