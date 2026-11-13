import { GoogleAuth } from 'google-auth-library';
import { createRequire } from 'node:module';
import { ProviderError } from '../src/common/errors';
import { resetEnvCache } from '../src/config/env';
import { createImageAdapter, createVideoAdapter } from '../src/providers/factory';
import { VertexImageProvider } from '../src/providers/image/vertex-image';
import { VertexLlm } from '../src/providers/llm/vertex-llm';
import { imageCapability, videoCapability } from '../src/providers/registry';
import type { ShotRenderSpec } from '../src/providers/types';
import { downloadVertexFile, vertexCall } from '../src/providers/vertex';
import { VertexOmniProvider } from '../src/providers/video/vertex-omni';

type Reply = { status?: number; json?: unknown; body?: string; throws?: Error };
let replies: Reply[];
let requests: Array<{ url: string; method: string; headers: Record<string, string>; body: unknown; redirect?: RequestInit['redirect'] }>;
let token: jest.SpyInstance;
const sdkAuth = createRequire(require.resolve('@ai-sdk/google-vertex'))('google-auth-library') as { GoogleAuth: typeof GoogleAuth };

beforeEach(() => {
  process.env.VERTEX_PROJECT_ID = 'credit-project';
  resetEnvCache();
  replies = [];
  requests = [];
  // 不查找本机凭据、不访问 OAuth，也不调用付费模型。
  token = jest.spyOn(GoogleAuth.prototype, 'getAccessToken').mockResolvedValue('adc-access-token');
  jest.spyOn(sdkAuth.GoogleAuth.prototype, 'getClient').mockResolvedValue({ getAccessToken: async () => ({ token: 'adc-access-token' }) } as never);
  jest.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
    requests.push({
      url: String(input), method: init?.method ?? 'GET',
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      redirect: init?.redirect,
    });
    const reply = replies.shift() ?? { json: {} };
    if (reply.throws) throw reply.throws;
    return new Response(reply.body ?? JSON.stringify(reply.json ?? {}), { status: reply.status ?? 200 });
  });
});
afterEach(() => {
  jest.restoreAllMocks();
  process.env.VERTEX_PROJECT_ID = '';
  resetEnvCache();
});

function spec(): ShotRenderSpec {
  return {
    shotId: 's1', durationSec: 5, resolution: '720p', aspectRatio: '9:16', productName: '猫窝',
    references: [], styleProfile: '自然', voiceProfile: '年轻女声',
    fields: { purpose: '展示', subject: '猫窝', videoType: '商品视频', camera: '推近', action: '展示猫窝', scene: '客厅', narration: '给猫一个自己的角落', consistency: '灰色猫窝' },
  };
}
const video = () => new VertexOmniProvider(videoCapability('vertex-gemini-omni-1.2-flash'));
const image = () => new VertexImageProvider(imageCapability('vertex-nano-banana-2.1'));
const base = 'https://aiplatform.googleapis.com/v1beta1/projects/credit-project/locations/global/interactions';

describe('Vertex AI 认证与路由', () => {
  it('登记为独立供应商，沿用 Omni 能力；工厂按键名创建正确适配器', () => {
    const cap = videoCapability('vertex-gemini-omni-1.2-flash');
    expect(cap).toMatchObject({ provider: 'google-vertex', modelId: 'gemini-omni-1.2-flash', regions: ['global'], limits: { maxConcurrency: 2, rpm: 30 } });
    expect(cap.duration).toEqual({ min: 3, max: 15, recommended: 5 });
    expect(createVideoAdapter(cap)).toBeInstanceOf(VertexOmniProvider);
    expect(createImageAdapter(imageCapability('vertex-nano-banana-2.1'))).toBeInstanceOf(VertexImageProvider);
    expect(token).not.toHaveBeenCalled();
  });

  it('已移除的 Gemini API 模型键明确报错，不把旧项目自动改走 Vertex', () => {
    expect(() => videoCapability('gemini-omni-1.2-flash')).toThrow(/直连入口已停用/);
    expect(() => imageCapability('nano-banana-2.1')).toThrow(/直连入口已停用/);
    expect(requests).toHaveLength(0);
  });

  it('每次向认证库获取有效 token，不把过期 token 固定在适配器上', async () => {
    token.mockResolvedValueOnce('token-before-refresh').mockResolvedValueOnce('token-after-refresh');
    await video().getTask('one');
    await video().getTask('two');
    expect(requests.map((r) => r.headers.authorization)).toEqual(['Bearer token-before-refresh', 'Bearer token-after-refresh']);
    expect(requests[0].headers['x-goog-user-project']).toBe('credit-project');
    expect(requests[0].headers['x-goog-api-key']).toBeUndefined();
    expect(requests[0].url).not.toContain('token');
  });

  it('缺项目 ID 时先报错，不查凭据、不访问网络', async () => {
    process.env.VERTEX_PROJECT_ID = '';
    resetEnvCache();
    await expect(video().getTask('one')).rejects.toMatchObject({ code: 'MISSING_PROJECT', retryable: false });
    expect(token).not.toHaveBeenCalled();
    expect(requests).toHaveLength(0);
  });

  it('认证失败不泄露 SDK 原始错误中的凭据内容', async () => {
    token.mockRejectedValue(new Error('private_key=secret-data'));
    const err = await video().getTask('one').catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'AUTH_FAILED', retryable: false });
    expect(String(err)).not.toContain('secret-data');
    expect(requests).toHaveLength(0);
  });

  it('调用地址不可信时，不向该地址发送凭据', async () => {
    await expect(vertexCall({ url: 'https://example.com', timeoutMs: 1000 })).rejects.toMatchObject({ code: 'BAD_API_URI' });
    expect(token).not.toHaveBeenCalled();
    expect(requests).toHaveLength(0);
  });
});

describe('Vertex AI 视频生命周期', () => {
  it('全局端点异步提交，参考图采用 reference_to_video，视频内联返回', async () => {
    replies = [{ json: { id: 'v1_task', status: 'in_progress' } }];
    const provider = video();
    expect(await provider.createTask({ compiled: provider.compile(spec()), images: [{ kind: 'base64', mime: 'image/png', data: 'AAAA' }] })).toEqual({ providerTaskId: 'v1_task' });
    expect(requests[0]).toMatchObject({
      url: base, method: 'POST', headers: { authorization: 'Bearer adc-access-token', 'api-revision': '2026-05-20' },
      body: {
        model: 'gemini-omni-1.2-flash', background: true, store: true,
        response_format: [{ type: 'video', delivery: 'inline', duration: '5s', aspect_ratio: '9:16', resolution: '720p' }],
        generation_config: { video_config: { task: 'reference_to_video' } },
      },
    });
    expect(JSON.stringify(requests[0].body)).not.toMatch(/music|BGM|soundtrack/i);
  });

  it('没有参考图时明确使用 text_to_video；不接受火山虚拟人像', async () => {
    const provider = video();
    expect(await provider.buildBody({ compiled: provider.compile(spec()), images: [] })).toMatchObject({ generation_config: { video_config: { task: 'text_to_video' } } });
    await expect(provider.buildBody({ compiled: provider.compile(spec()), images: [{ kind: 'asset', uri: 'asset://x' }] })).rejects.toMatchObject({ code: 'NOT_SUPPORTED' });
    expect(requests).toHaveLength(0);
  });

  it('轮询、下载内联视频、转存后清理均使用同一 Vertex 入口', async () => {
    const mp4 = Buffer.from('mp4-bytes');
    const done = { status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'video', data: mp4.toString('base64') }] }], usage: { total_tokens: 8 } };
    replies = [{ json: done }, { json: done }, { json: {} }];
    const provider = video();
    expect(await provider.getTask('v1_task')).toMatchObject({ state: 'succeeded', resultRef: 'interaction:v1_task', usage: { total_tokens: 8 } });
    expect(await provider.downloadResult('interaction:v1_task', 'v1_task')).toEqual(mp4);
    await provider.cleanup('v1_task');
    expect(requests.map((r) => `${r.method} ${r.url}`)).toEqual([`GET ${base}/v1_task`, `GET ${base}/v1_task`, `DELETE ${base}/v1_task`]);
  });

  it('取消已提交任务；供应商不允许取消时返回 not_cancellable', async () => {
    replies = [{ json: { status: 'cancelled' } }, { status: 400, json: { error: { status: 'FAILED_PRECONDITION' } } }];
    expect(await video().cancelTask('one')).toBe('cancelled');
    expect(await video().cancelTask('two')).toBe('not_cancellable');
    expect(requests[0].url).toBe(`${base}/one/cancel`);
  });

  it('429 标记为可重试；提交超时标记为结果不确定，禁止自动重发', async () => {
    replies = [{ status: 429, json: { error: { status: 'RESOURCE_EXHAUSTED', message: 'quota' } } }, { throws: Object.assign(new Error('timeout'), { name: 'TimeoutError' }) }];
    const provider = video();
    const req = { compiled: provider.compile(spec()), images: [] };
    await expect(provider.createTask(req)).rejects.toMatchObject({ code: 'RESOURCE_EXHAUSTED', retryable: true });
    await expect(provider.createTask(req)).rejects.toMatchObject({ code: 'SUBMIT_UNKNOWN', retryable: false });
    expect(requests).toHaveLength(2);
  });

  it.each(['network', 'server', 'missing-id', 'invalid-id'])('%s 提交结果不确定，不自动重发', async (kind) => {
    replies = kind === 'network' ? [{ throws: new TypeError('connection reset') }]
      : [{ status: kind === 'server' ? 503 : 200, json: kind === 'invalid-id' ? { id: 42 } : {} }];
    const provider = video();
    await expect(provider.createTask({ compiled: provider.compile(spec()), images: [] })).rejects.toMatchObject({ code: 'SUBMIT_UNKNOWN', retryable: false });
    expect(requests).toHaveLength(1);
  });

  it('模型拒绝或没有视频时返回失败，不把它当成成功片段', async () => {
    replies = [
      { json: { status: 'failed', error: { status: 'INVALID_ARGUMENT', message: 'blocked' } } },
      { json: { status: 'completed', steps: [] } },
    ];
    expect(await video().getTask('one')).toMatchObject({ state: 'failed', error: { code: 'INVALID_ARGUMENT' } });
    expect(await video().getTask('two')).toMatchObject({ state: 'failed', error: { code: 'NO_VIDEO' } });
  });

  it('Cloud Storage 文件引用按官方接口下载，禁止重定向和外部域名', async () => {
    replies = [{ body: 'video' }];
    expect((await downloadVertexFile('gs://video-bucket/clips/clip%201.mp4', 1000)).toString()).toBe('video');
    expect(requests[0]).toMatchObject({ url: 'https://storage.googleapis.com/storage/v1/b/video-bucket/o/clips%2Fclip%201.mp4?alt=media', headers: { authorization: 'Bearer adc-access-token' }, redirect: 'error' });
    for (const uri of ['https://evil.example/video.mp4', 'https://aiplatform.googleapis.com.evil.example/x', 'http://storage.googleapis.com/x', 'https://user:password@storage.googleapis.com/x']) {
      await expect(downloadVertexFile(uri, 1000)).rejects.toMatchObject({ code: 'BAD_RESULT_URI' });
    }
    expect(requests).toHaveLength(1);
  });
});

describe('Vertex AI 图片与多模态大模型', () => {
  it('大模型缺少 ADC 时提示 Google 登录；完成认证后同一适配器可以重试', async () => {
    const provider = new VertexLlm();
    token.mockRejectedValueOnce(new Error('Could not load default credentials; private_key=secret-data'));
    const request = { purpose: 'analyze_product' as const, system: 's', user: 'u' };
    const err = await provider.complete(request).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'AUTH_FAILED', retryable: false });
    expect(String(err)).toContain('gcloud auth application-default login');
    expect(String(err)).not.toContain('secret-data');
    expect(requests).toHaveLength(0);
    replies = [{ json: { candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }] } }];
    expect(await provider.complete(request)).toMatchObject({ content: '{"ok":true}' });
    expect(requests).toHaveLength(1);
  });

  it('原生接口生成、编辑图片，保存实际 MIME 与用量', async () => {
    const png = Buffer.from('png-bytes');
    replies = [{ json: { candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: png.toString('base64') } }] } }], usageMetadata: { totalTokenCount: 4 } } }];
    expect(await image().generate({ prompt: '白底商品图', images: [{ kind: 'base64', mime: 'image/jpeg', data: 'AAAA' }] })).toEqual({ data: png, mime: 'image/png', usage: { totalTokenCount: 4 } });
    expect(requests[0]).toMatchObject({
      url: 'https://aiplatform.googleapis.com/v1/projects/credit-project/locations/global/publishers/google/models/gemini-nano-banana-2.1:generateContent',
      body: { contents: [{ role: 'user', parts: [{ text: '白底商品图' }, { inlineData: { mimeType: 'image/jpeg', data: 'AAAA' } }] }], generationConfig: { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio: '9:16', imageSize: '1K' } } },
    });
  });

  it('看图、JSON 输出、修正对话使用原生格式，忽略思考内容', async () => {
    replies = [{ json: { candidates: [{ content: { parts: [{ text: 'internal reasoning', thought: true }, { text: '{"ok":true}' }] } }], usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 5, totalTokenCount: 9 } } }];
    expect(await new VertexLlm().complete({ purpose: 'analyze_product', system: 'system', user: '看图', images: ['data:image/png;base64,AAAA'], followUps: [{ role: 'assistant', content: '{}' }, { role: 'user', content: '请修正' }] })).toMatchObject({ content: '{"ok":true}', usage: { totalTokens: 9 } });
    expect(requests[0]).toMatchObject({
      url: 'https://aiplatform.googleapis.com/v1/projects/credit-project/locations/global/publishers/google/models/gemini-4-hydrogen:generateContent',
      body: { systemInstruction: { parts: [{ text: 'system' }] }, contents: [{ role: 'user', parts: [{ text: '看图' }, { inlineData: { mimeType: 'image/png', data: 'AAAA' } }] }, { role: 'model', parts: [{ text: '{}' }] }, { role: 'user', parts: [{ text: '请修正' }] }], generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 8000 } },
    });
  });

  it('安全过滤后的空结果明确失败，不误用文本当图片或思考内容当回答', async () => {
    replies = [
      { json: { promptFeedback: { blockReason: 'SAFETY' } } },
      { json: { candidates: [{ content: { parts: [{ text: 'thought', thought: true }] } }] } },
    ];
    await expect(image().generate({ prompt: '画图' })).rejects.toBeInstanceOf(ProviderError);
    await expect(new VertexLlm().complete({ purpose: 'qc', system: 's', user: 'u' })).rejects.toMatchObject({ code: 'EMPTY' });
  });
});
