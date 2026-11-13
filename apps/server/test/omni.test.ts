import { httpJson } from '../src/providers/http';
import { OpenAiCompatibleLlm, thinkingFields } from '../src/providers/llm/openai-compatible';
import type { ShotRenderSpec } from '../src/providers/types';
import { compileOmniPrompt, sanitizeOmniText } from '../src/providers/video/vertex-omni';

/** 测试用的假接口：记录请求，按顺序返回预设结果（不访问网络） */
type Reply = { status?: number; json?: unknown; body?: string; throws?: Error };
let replies: Reply[] = [];
let requests: Array<{ url: string; method: string; headers: Record<string, string>; body: unknown }> = [];

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
