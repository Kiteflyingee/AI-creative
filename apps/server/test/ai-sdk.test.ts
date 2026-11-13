import { z } from 'zod';
import { ProviderError } from '../src/common/errors';
import { resetEnvCache } from '../src/config/env';
import { createImageAdapter, createVideoAdapter } from '../src/providers/factory';
import { SeedreamProvider } from '../src/providers/image/seedream';
import { createLlmAdapter } from '../src/providers/llm/factory';
import { LlmService } from '../src/providers/llm/llm.service';
import { imageCapability, videoCapability } from '../src/providers/registry';
import { SeedanceProvider } from '../src/providers/video/seedance';

const req = { purpose: 'qc' as const, system: '只返回 JSON', user: '看图', images: ['data:image/png;base64,AAAA'] };
let original: NodeJS.ProcessEnv;
let requests: Array<{ url: string; headers: Headers; body: Record<string, unknown>; redirect?: RequestInit['redirect'] }>;
let replies: Array<{ status?: number; content?: string; throws?: Error; headers?: Record<string, string> }>;

beforeEach(() => {
  original = { ...process.env };
  requests = [];
  replies = [];
  process.env.DEEPSEEK_API_KEY = 'deepseek-test-key';
  process.env.ARK_API_KEY = 'ark-test-key';
  process.env.LLM_BASE_URL = 'https://compatible.example/v1';
  process.env.LLM_API_KEY = 'compatible-test-key';
  process.env.LLM_MODEL = 'vision-model';
  process.env.LLM_THINKING_PARAM = 'reasoning_effort';
  resetEnvCache();
  jest.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
    requests.push({ url: String(input), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)), redirect: init?.redirect });
    const reply = replies.shift() ?? {};
    if (reply.throws) throw reply.throws;
    const json = reply.status && reply.status !== 200
      ? { error: { message: 'do not expose Bearer compatible-test-key or image payload' } }
      : { id: 'chat-1', created: 1, model: 'vision-model', choices: [{ message: { role: 'assistant', content: reply.content ?? '{"ok":true}' }, finish_reason: 'stop', index: 0 }], usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 } };
    return new Response(JSON.stringify(json), { status: reply.status ?? 200, headers: { 'content-type': 'application/json', ...reply.headers } });
  });
});

afterEach(() => {
  jest.restoreAllMocks();
  process.env = original;
  resetEnvCache();
});

it.each([
  ['deepseek', 'https://api.deepseek.com/chat/completions', 'deepseek-test-key', 'deepseek-flash'],
  ['ark', 'https://ark.cn-beijing.volces.com/api/v3/chat/completions', 'ark-test-key', 'deepseek-v4-1-flash-261017'],
  ['openai_compatible', 'https://compatible.example/v1/chat/completions', 'compatible-test-key', 'vision-model'],
])('%s 使用自己的地址、凭据和模型；看图/JSON/修正对话保留', async (provider, url, key, model) => {
  process.env.LLM_PROVIDER = provider;
  resetEnvCache();
  const result = await createLlmAdapter().complete({ ...req, thinking: true, maxTokens: 1234, followUps: [{ role: 'assistant', content: '{}' }, { role: 'user', content: '修正' }] });
  expect(result).toMatchObject({ content: '{"ok":true}', usage: { totalTokens: 5 } });
  expect(requests).toHaveLength(1);
  expect(requests[0].url).toBe(url);
  expect(requests[0].headers.get('authorization')).toBe(`Bearer ${key}`);
  expect(requests[0].redirect).toBe('error');
  expect(requests[0].body).toMatchObject({ model, max_tokens: 1234, response_format: { type: 'json_object' } });
  expect(requests[0].body).toMatchObject(provider === 'openai_compatible' ? { reasoning_effort: 'high' } : { thinking: { type: 'enabled' } });
  const messages = requests[0].body.messages as Array<{ content: unknown }>;
  expect(messages[1].content).toContainEqual({ type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } });
  expect(messages.slice(-2)).toEqual([{ role: 'assistant', content: '{}' }, { role: 'user', content: '修正' }]);
  expect(requests[0].url).not.toMatch(/vercel|gateway|3002/);
});

it('不合法 JSON 与业务校验失败仍通过原有修正对话重试', async () => {
  process.env.LLM_PROVIDER = 'openai_compatible';
  resetEnvCache();
  replies = [{ content: 'not JSON' }, { content: '{"ok":false}' }, { content: '{"ok":true}' }];
  const service = new LlmService(createLlmAdapter());
  expect(await service.completeJson(req, z.object({ ok: z.literal(true) }))).toEqual({ ok: true });
  expect(requests).toHaveLength(3);
  expect(JSON.stringify(requests[1].body.messages)).toContain('not JSON');
  expect(JSON.stringify(requests[2].body.messages)).toContain('上面的输出不符合要求');
});

it.each([429, 401, 503])('HTTP %i 不发生 SDK 隐式重试，不暴露上游敏感错误', async (status) => {
  process.env.LLM_PROVIDER = 'openai_compatible';
  resetEnvCache();
  replies = [{ status }];
  const err = await createLlmAdapter().complete(req).catch((e: unknown) => e);
  expect(err).toMatchObject({ code: `HTTP_${status}`, retryable: status !== 401, httpStatus: status });
  expect(String(err)).not.toMatch(/compatible-test-key|image payload/);
  expect(requests).toHaveLength(1);
});

it('兼容接口可关闭协议 JSON 模式，仍由业务层校验', async () => {
  process.env.LLM_PROVIDER = 'openai_compatible';
  process.env.LLM_JSON_MODE = 'none';
  process.env.LLM_THINKING_PARAM = 'none';
  resetEnvCache();
  replies = [{ content: '```json\n{"ok":true}\n```' }];
  expect(await new LlmService(createLlmAdapter()).completeJson(req, z.object({ ok: z.literal(true) }))).toEqual({ ok: true });
  expect(requests[0].body.response_format).toBeUndefined();
  expect(requests[0].body.reasoning_effort).toBeUndefined();
});

it('缺凭据或未登记供应商明确失败，不路由到默认网关或其他供应商', async () => {
  process.env.LLM_PROVIDER = 'openai_compatible';
  process.env.LLM_API_KEY = '';
  resetEnvCache();
  await expect(createLlmAdapter().complete(req)).rejects.toMatchObject({ code: 'MISSING_API_KEY' });
  process.env.LLM_PROVIDER = 'vertex';
  resetEnvCache();
  await expect(createLlmAdapter().complete(req)).rejects.toMatchObject({ code: 'MISSING_PROJECT' });
  expect(() => createVideoAdapter({ ...videoCapability('seedance-2.5'), provider: 'unknown' })).toThrow('未实现');
  expect(() => createImageAdapter({ ...imageCapability('seedream-5.0-pro'), provider: 'unknown' })).toThrow('未实现');
  expect(requests).toHaveLength(0);
});

it('火山图片与视频恢复原生适配器', () => {
  expect(createVideoAdapter(videoCapability('seedance-2.5'))).toBeInstanceOf(SeedanceProvider);
  expect(createImageAdapter(imageCapability('seedream-5.0-pro'))).toBeInstanceOf(SeedreamProvider);
});

it('保留 DeepSeek 自定义 API 前缀，不额外插入版本路径', async () => {
  process.env.LLM_PROVIDER = 'deepseek';
  process.env.DEEPSEEK_BASE_URL = 'https://api.deepseek.com/beta';
  resetEnvCache();
  await createLlmAdapter().complete(req);
  expect(requests[0].url).toBe('https://api.deepseek.com/beta/chat/completions');
});

it('网络断开给出明确提示且不暴露原始错误内容，不隐式重试', async () => {
  process.env.LLM_PROVIDER = 'openai_compatible';
  resetEnvCache();
  replies = [{ throws: Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('socket closed compatible-test-key'), { code: 'ECONNRESET' }) }) }];
  const err = await createLlmAdapter().complete(req).catch((e: unknown) => e);
  expect(err).toMatchObject({ code: 'NETWORK' });
  expect(String(err)).toContain('网络连接中断');
  expect(String(err)).not.toContain('compatible-test-key');
  expect(requests).toHaveLength(1);
});

it.each(['5', 'date', 'invalid'])('429 的 Retry-After %s 能安全交给业务退避', async (value) => {
  process.env.LLM_PROVIDER = 'openai_compatible';
  resetEnvCache();
  const header = value === 'date' ? new Date(Date.now() + 20000).toUTCString() : value;
  replies = [{ status: 429, headers: { 'retry-after': header } }];
  const err = await createLlmAdapter().complete(req).catch((e: unknown) => e);
  expect(err).toMatchObject({ code: 'HTTP_429', httpStatus: 429 });
  if (!(err instanceof ProviderError)) throw err;
  if (value === '5') expect(err.retryAfterMs).toBe(5000);
  else if (value === 'date') {
    expect(err.retryAfterMs).toBeGreaterThan(15000);
    expect(err.retryAfterMs).toBeLessThanOrEqual(20000);
  } else expect(err.retryAfterMs).toBeUndefined();
  expect(requests).toHaveLength(1);
});
