import { ProviderError } from '../src/common/errors';
import { resetEnvCache } from '../src/config/env';
import { httpJson } from '../src/providers/http';
import { NanoBananaProvider, parseImageInteraction } from '../src/providers/image/nano-banana';
import { OpenAiCompatibleLlm, thinkingFields } from '../src/providers/llm/openai-compatible';
import { imageCapability, videoCapability } from '../src/providers/registry';
import type { ShotRenderSpec } from '../src/providers/types';
import { compileOmniPrompt, GeminiOmniProvider, mapInteractionStatus, parseInteraction, sanitizeOmniText } from '../src/providers/video/gemini-omni';

/** 测试用的假接口：记录请求，按顺序返回预设结果（不访问网络） */
type Reply = { status?: number; json?: unknown; body?: string; throws?: Error };
let replies: Reply[] = [];
let requests: Array<{ url: string; method: string; headers: Record<string, string>; body: unknown }> = [];

beforeAll(() => {
  process.env.GEMINI_API_KEY = 'test-gemini-key';
  resetEnvCache();
});
afterAll(() => {
  process.env.GEMINI_API_KEY = '';
  resetEnvCache();
});
beforeEach(() => {
  replies = [];
  requests = [];
  jest.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
    requests.push({
      url: String(input),
      method: init?.method ?? 'GET',
      headers,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    });
    const reply = replies.shift() ?? { json: {} };
    if (reply.throws) throw reply.throws;
    return new Response(reply.body ?? JSON.stringify(reply.json ?? {}), { status: reply.status ?? 200 });
  });
});
afterEach(() => jest.restoreAllMocks());

function spec(overrides: Partial<ShotRenderSpec> = {}): ShotRenderSpec {
  return {
    shotId: 'shot_1',
    durationSec: 5,
    resolution: '720p',
    aspectRatio: '9:16',
    productName: '猫窝',
    references: [
      { refId: 'scn', kind: 'scene', name: '客厅', description: '明亮客厅', role: 'primary', image: { type: 'asset', assetId: 'a_scene' } },
      { refId: 'chr', kind: 'character', name: '小雅', description: '25 岁女性', role: 'primary', image: { type: 'asset', assetId: 'a_person' } },
      { refId: 'prd', kind: 'product', name: '灰色猫窝', description: '条纹外罩', role: 'primary', image: { type: 'asset', assetId: 'a_ai' } },
      { refId: 'prd', kind: 'product', name: '灰色猫窝', description: '', role: 'original_detail', image: { type: 'asset', assetId: 'a_orig' } },
    ],
    fields: {
      purpose: '开场钩子',
      subject: '小雅和猫窝',
      videoType: '好物分享短视频',
      camera: '镜头缓慢推近',
      action: '小雅把猫窝放到角落。',
      scene: '傍晚客厅，暖光',
      narration: '给猫一个"自己的"角落<IMAGE_REF_0>',
      consistency: '猫窝保持灰色',
    },
    styleProfile: '日系清新',
    voiceProfile: '温柔亲切的年轻女声',
    ...overrides,
  };
}

const omni = () => new GeminiOmniProvider(videoCapability('gemini-omni-1.2-flash'));

describe('Gemini Omni 提示词编译', () => {
  it('按“商品 → 商品原图 → 人物 → 场景”编号参考图，用自然语言说明用途', () => {
    const { images, prompt } = compileOmniPrompt(spec(), 6);
    expect(images).toEqual([
      { type: 'asset', assetId: 'a_ai' },
      { type: 'asset', assetId: 'a_orig' },
      { type: 'asset', assetId: 'a_person' },
      { type: 'asset', assetId: 'a_scene' },
    ]);
    expect(prompt).toContain('- Image 1: the product "灰色猫窝" (条纹外罩).');
    expect(prompt).toContain('- Image 2: the original photo of the product "灰色猫窝"');
    expect(prompt).toContain('- Image 3: the character "小雅" (25 岁女性).');
    expect(prompt).toContain('- Image 4: the setting "客厅" (明亮客厅).');
    expect(prompt).toContain('they are not frames of the video');
  });

  it('要求单个连续镜头、不渲染字幕；不写任何背景音乐要求', () => {
    const { prompt } = compileOmniPrompt(spec(), 6);
    expect(prompt.split('\n')[0]).toContain('A single continuous shot with no scene cuts');
    expect(prompt).toContain('Do not render subtitles, captions or any overlay text.');
    expect(prompt).not.toMatch(/music|BGM|soundtrack|背景音乐|配乐/i);
  });

  it('口播逐字放进引号并注明普通话；引号和控制标签被清洗；句末标点不重复', () => {
    const { prompt } = compileOmniPrompt(spec(), 6);
    expect(prompt).toContain('Speech: voice is 温柔亲切的年轻女声. Say exactly this line in Mandarin Chinese, once, without adding or changing any words: "给猫一个 自己的 角落 IMAGE_REF_0"');
    expect(prompt).not.toContain('<IMAGE_REF_0>');
    expect(prompt).toContain('Action: 小雅把猫窝放到角落.');
    expect(sanitizeOmniText('a"b“c”<d>{e}[f]@g')).toBe('a b c d e f g');
  });

  it('没有口播的镜头写明无对白、无旁白', () => {
    const { prompt } = compileOmniPrompt(spec({ fields: { ...spec().fields, narration: '' } }), 6);
    expect(prompt).toContain('Speech: no dialogue and no voiceover.');
  });

  it('超出上限的参考图改为文字描述：最多 6 张、最多 2 个人物', () => {
    const people = [1, 2, 3].map((i) => ({
      refId: `c${i}`,
      kind: 'character' as const,
      name: `人物${i}`,
      description: `描述${i}`,
      role: 'primary' as const,
      image: { type: 'asset' as const, assetId: `p${i}` },
    }));
    const products = [1, 2, 3, 4].map((i) => ({
      refId: `g${i}`,
      kind: 'product' as const,
      name: `商品${i}`,
      description: '',
      role: 'primary' as const,
      image: { type: 'asset' as const, assetId: `g${i}` },
    }));
    const { images, prompt } = compileOmniPrompt(spec({ references: [...people, ...products] }), 6);
    expect(images.map((i) => (i.type === 'asset' ? i.assetId : ''))).toEqual(['g1', 'g2', 'g3', 'g4', 'p1', 'p2']);
    expect(prompt).toContain('Described without a reference image:\n- Character "人物3": 描述3.');
  });

  it('同一输入编译结果完全相同', () => {
    expect(compileOmniPrompt(spec(), 6)).toEqual(compileOmniPrompt(spec(), 6));
  });
});

describe('Gemini Omni 请求', () => {
  it('参数：9:16、分辨率、时长写成 "5s"；时长另记为整数', () => {
    const compiled = omni().compile(spec());
    expect(compiled.params).toEqual({ aspect_ratio: '9:16', resolution: '720p', duration: '5s' });
    expect(compiled.durationSec).toBe(5);
  });

  it('请求体：图片在前（Base64 内联）、提示词在后、后台执行', async () => {
    const provider = omni();
    const compiled = provider.compile(spec());
    const body = await provider.buildBody({ compiled, images: [{ kind: 'base64', mime: 'image/png', data: 'AAAA' }] });
    expect(body).toEqual({
      model: 'gemini-omni-1.2-flash',
      input: [
        { type: 'image', data: 'AAAA', mime_type: 'image/png' },
        { type: 'text', text: compiled.prompt },
      ],
      response_format: { type: 'video', aspect_ratio: '9:16', resolution: '720p', duration: '5s' },
      background: true,
    });
  });

  it('火山虚拟人像不能发给 Gemini', async () => {
    const provider = omni();
    await expect(provider.buildBody({ compiled: provider.compile(spec()), images: [{ kind: 'asset', uri: 'asset://x' }] })).rejects.toMatchObject({
      code: 'NOT_SUPPORTED',
      retryable: false,
    });
  });

  it('创建任务：密钥放在 x-goog-api-key 请求头，不出现在 URL 里；带 Api-Revision', async () => {
    replies = [{ json: { id: 'v1_abc', status: 'in_progress' } }];
    const provider = omni();
    const res = await provider.createTask({ compiled: provider.compile(spec()), images: [] });
    expect(res).toEqual({ providerTaskId: 'v1_abc' });
    const req = requests[0]!;
    expect(req).toMatchObject({ url: 'https://generativelanguage.googleapis.com/v1beta/interactions', method: 'POST' });
    expect(req.url).not.toContain('key=');
    expect(req.headers['x-goog-api-key']).toBe('test-gemini-key');
    expect(req.headers['authorization']).toBeUndefined();
    expect(req.headers['api-revision']).toBe('2026-05-20');
  });

  it('提交超时：无法确认是否已创建任务，不自动重试（避免重复生成）', async () => {
    const timeout = new Error('timeout');
    timeout.name = 'TimeoutError';
    replies = [{ throws: timeout }];
    const provider = omni();
    await expect(provider.createTask({ compiled: provider.compile(spec()), images: [] })).rejects.toMatchObject({
      code: 'SUBMIT_UNKNOWN',
      retryable: false,
    });
  });

  it('限流 429 可重试；Google 的错误码取 status 字段', async () => {
    replies = [{ status: 429, json: { error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'quota' } } }];
    const provider = omni();
    const err = await provider.createTask({ compiled: provider.compile(spec()), images: [] }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err).toMatchObject({ code: 'RESOURCE_EXHAUSTED', retryable: true, httpStatus: 429 });
  });

  it('解析任务状态', () => {
    expect(mapInteractionStatus('in_progress')).toBe('running');
    expect(mapInteractionStatus('requires_action')).toBe('unknown');
    const inline = parseInteraction(
      { id: 'v1_a', status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'video', mime_type: 'video/mp4', data: 'AAAA' }] }], usage: { total_tokens: 1 } },
      'v1_a',
    );
    expect(inline).toMatchObject({ state: 'succeeded', resultRef: 'interaction:v1_a', usage: { total_tokens: 1 } });
    const uri = parseInteraction(
      { status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'video', uri: 'https://generativelanguage.googleapis.com/v1beta/files/x:download?alt=media' }] }] },
      'v1_b',
    );
    expect(uri.resultRef).toBe('https://generativelanguage.googleapis.com/v1beta/files/x:download?alt=media');
    const blocked = parseInteraction({ status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'text', text: 'blocked by safety filters' }] }] }, 'v1_c');
    expect(blocked).toMatchObject({ state: 'failed', error: { code: 'NO_VIDEO' } });
    expect(blocked.error!.message).toContain('blocked by safety filters');
    const failed = parseInteraction({ status: 'failed', error: { code: 400, status: 'INVALID_ARGUMENT', message: 'bad' } }, 'v1_d');
    expect(failed).toMatchObject({ state: 'failed', error: { code: 'INVALID_ARGUMENT', message: 'bad' } });
  });

  it('下载结果：内联视频解码 Base64；文件地址只对 Google 域名带密钥', async () => {
    const provider = omni();
    const mp4 = Buffer.from('fake-mp4-bytes');
    replies = [{ json: { status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'video', data: mp4.toString('base64') }] }] } }];
    expect(await provider.downloadResult('interaction:v1_a', 'v1_a')).toEqual(mp4);
    expect(requests[0]!.url).toBe('https://generativelanguage.googleapis.com/v1beta/interactions/v1_a');

    replies = [{ body: 'video-from-file' }];
    const file = await provider.downloadResult('https://generativelanguage.googleapis.com/v1beta/files/x:download?alt=media', 'v1_a');
    expect(file.toString()).toBe('video-from-file');
    expect(requests[1]!.headers['x-goog-api-key']).toBe('test-gemini-key');

    await expect(provider.downloadResult('https://evil.example.com/v.mp4', 'v1_a')).rejects.toMatchObject({ code: 'BAD_RESULT_URI' });
    expect(requests).toHaveLength(2);
  });

  it('取消与清理', async () => {
    replies = [{ json: {} }, { json: {} }, { status: 400, json: { error: { status: 'FAILED_PRECONDITION', message: 'done' } } }];
    const provider = omni();
    expect(await provider.cancelTask('v1_a')).toBe('cancelled');
    await provider.cleanup('v1_a');
    expect(await provider.cancelTask('v1_b')).toBe('not_cancellable');
    expect(requests.map((r) => `${r.method} ${r.url}`)).toEqual([
      'POST https://generativelanguage.googleapis.com/v1beta/interactions/v1_a/cancel',
      'DELETE https://generativelanguage.googleapis.com/v1beta/interactions/v1_a',
      'POST https://generativelanguage.googleapis.com/v1beta/interactions/v1_b/cancel',
    ]);
  });

  it('没有配置密钥时直接报错，不发请求', async () => {
    process.env.GEMINI_API_KEY = '';
    resetEnvCache();
    try {
      const provider = omni();
      await expect(provider.getTask('v1_a')).rejects.toMatchObject({ code: 'MISSING_API_KEY', retryable: false });
      expect(requests).toHaveLength(0);
    } finally {
      process.env.GEMINI_API_KEY = 'test-gemini-key';
      resetEnvCache();
    }
  });
});

describe('Nano Banana', () => {
  const nano = () => new NanoBananaProvider(imageCapability('nano-banana-2.1'));

  it('请求体：只要图片输出，9:16，1K 档', async () => {
    const body = await nano().buildBody({ prompt: '白底商品图', images: [{ kind: 'base64', mime: 'image/jpeg', data: 'BBBB' }] });
    expect(body).toEqual({
      model: 'gemini-nano-banana-2.1',
      input: [
        { type: 'text', text: '白底商品图' },
        { type: 'image', data: 'BBBB', mime_type: 'image/jpeg' },
      ],
      response_format: { type: 'image', aspect_ratio: '9:16', image_size: '1K' },
    });
  });

  it('生成并解析图片；没有图片时报错并带上模型说明', async () => {
    const png = Buffer.from('png-bytes');
    replies = [{ json: { status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'image', mime_type: 'image/png', data: png.toString('base64') }] }] } }];
    const result = await nano().generate({ prompt: '一位 30 岁女性' });
    expect(result).toMatchObject({ mime: 'image/png' });
    expect(result.data).toEqual(png);
    expect(requests[0]!.headers['x-goog-api-key']).toBe('test-gemini-key');
    expect(() => parseImageInteraction({ steps: [{ type: 'model_output', content: [{ type: 'text', text: 'cannot' }] }] })).toThrow(/cannot/);
  });
});

describe('大模型供应商可配置', () => {
  it('思考参数按供应商写法', () => {
    expect(thinkingFields('deepseek', true)).toEqual({ thinking: { type: 'enabled' } });
    expect(thinkingFields('reasoning_effort', false)).toEqual({ reasoning_effort: 'low' });
    expect(thinkingFields('none', true)).toEqual({});
  });

  it('OpenAI 兼容接口：地址、模型可配置；关闭 JSON 模式时不传 response_format', async () => {
    replies = [{ json: { choices: [{ message: { content: '{"ok":true}' } }] } }];
    const llm = new OpenAiCompatibleLlm({
      provider: 'llm',
      baseUrl: 'https://llm.example.com/v1/',
      apiKey: 'k',
      modelId: 'some-model',
      thinkingParam: 'reasoning_effort',
      jsonMode: 'none',
    });
    await llm.complete({ purpose: 'qc', system: 's', user: 'u', thinking: true });
    expect(requests[0]!.url).toBe('https://llm.example.com/v1/chat/completions');
    expect(requests[0]!.body).toMatchObject({ model: 'some-model', reasoning_effort: 'high' });
    expect(requests[0]!.body).not.toHaveProperty('response_format');
    expect(requests[0]!.body).not.toHaveProperty('thinking');
  });

  it('火山返回字符串错误码', async () => {
    replies = [{ status: 400, json: { error: { code: 'InvalidParameter', message: 'bad' } } }];
    await expect(httpJson({ provider: 'seedance', url: 'https://x.example.com', apiKey: 'k', timeoutMs: 1000 })).rejects.toMatchObject({
      code: 'InvalidParameter',
      retryable: false,
    });
  });
});
