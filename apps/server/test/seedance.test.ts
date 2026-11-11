import { videoCapability } from '../src/providers/registry';
import type { ShotRenderSpec } from '../src/providers/types';
import { compileSeedancePrompt, mapArkStatus, parseArkTask, sanitizePromptText, SeedanceProvider } from '../src/providers/video/seedance';

function spec(overrides: Partial<ShotRenderSpec> = {}): ShotRenderSpec {
  return {
    shotId: 'shot_1',
    durationSec: 5,
    resolution: '720p',
    aspectRatio: '9:16',
    productName: '猫窝',
    references: [
      { refId: 'scn', kind: 'scene', name: '客厅', description: '明亮客厅', role: 'primary', image: { type: 'asset', assetId: 'a_scene' } },
      { refId: 'chr', kind: 'character', name: '小雅', description: '25 岁女性', role: 'primary', image: { type: 'virtual_portrait', portraitId: 'asset-1' } },
      { refId: 'prd', kind: 'product', name: '灰色猫窝', description: '条纹外罩', role: 'primary', image: { type: 'asset', assetId: 'a_ai' } },
      { refId: 'prd', kind: 'product', name: '灰色猫窝', description: '', role: 'original_detail', image: { type: 'asset', assetId: 'a_orig' } },
    ],
    fields: {
      purpose: '开场钩子',
      subject: '小雅和猫窝',
      videoType: '好物分享短视频',
      camera: '镜头缓慢推近',
      action: '小雅把猫窝放到角落',
      scene: '傍晚客厅，暖光',
      narration: '给猫一个{自己的}角落【字幕】',
      consistency: '猫窝保持灰色',
    },
    styleProfile: '日系清新',
    voiceProfile: '温柔亲切的年轻女声',
    ...overrides,
  };
}

describe('Seedance 提示词编译', () => {
  it('按“商品→人物→场景”的顺序编号参考图，原图排在 AI 修改图之后', () => {
    const { images, prompt } = compileSeedancePrompt(spec());
    expect(images).toEqual([
      { type: 'asset', assetId: 'a_ai' },
      { type: 'asset', assetId: 'a_orig' },
      { type: 'virtual_portrait', portraitId: 'asset-1' },
      { type: 'asset', assetId: 'a_scene' },
    ]);
    expect(prompt).toContain('@图像1 是商品「灰色猫窝」（条纹外罩）');
    expect(prompt).toContain('@图像2 是商品「灰色猫窝」的原始实拍图');
    expect(prompt).toContain('@图像3 是人物「小雅」');
    expect(prompt).toContain('@图像4 是场景「客厅」');
  });

  it('口播逐字放进 {}，商家文字里的特殊符号被清洗', () => {
    const { prompt } = compileSeedancePrompt(spec());
    expect(prompt).toContain('口播：{给猫一个 自己的 角落 字幕}');
    expect(prompt).toContain('严格按台词生成口播，不增减台词');
    expect(prompt).not.toMatch(/【|】/);
    expect(sanitizePromptText('a{b}c(d)<e>@f')).toBe('a b c d e f');
  });

  it('要求不生成字幕和水印，不写任何背景音乐要求', () => {
    const { prompt } = compileSeedancePrompt(spec());
    expect(prompt).toContain('不生成字幕和水印');
    expect(prompt).not.toMatch(/背景音乐|BGM|配乐/);
  });

  it('没有口播的镜头写明无口播', () => {
    const { prompt } = compileSeedancePrompt(spec({ fields: { ...spec().fields, narration: '' } }));
    expect(prompt).toContain('本镜头无口播');
    expect(prompt).not.toContain('{');
  });

  it('同一输入编译结果完全相同', () => {
    expect(compileSeedancePrompt(spec())).toEqual(compileSeedancePrompt(spec()));
  });

  it('没有图片的参考只用文字描述', () => {
    const s = spec({
      references: [{ refId: 'chr', kind: 'character', name: '小雅', description: '25 岁女性', role: 'primary', image: null }],
    });
    const { prompt, images } = compileSeedancePrompt(s);
    expect(images).toEqual([]);
    expect(prompt).toContain('人物「小雅」：25 岁女性');
  });
});

describe('Seedance 请求', () => {
  const provider = new SeedanceProvider(videoCapability('seedance-2.5'));

  it('参考图模式：9:16、关闭水印、生成声音、指定时长与分辨率', () => {
    const compiled = provider.compile(spec());
    expect(compiled.params).toEqual({
      ratio: '9:16',
      resolution: '720p',
      duration: 5,
      generate_audio: true,
      watermark: false,
      omni_reference_task_type: 'reference',
    });
    const body = provider.buildBody({
      compiled,
      images: [
        { kind: 'base64', mime: 'image/jpeg', data: 'AAAA' },
        { kind: 'url', url: 'https://example.com/a.jpg' },
        { kind: 'asset', uri: 'asset://asset-1' },
        { kind: 'url', url: 'https://example.com/b.jpg' },
      ],
    });
    expect(body.model).toBe('doubao-seedance-2-5-260628');
    const content = body.content as Array<Record<string, unknown>>;
    expect(content[0]).toEqual({ type: 'text', text: compiled.prompt });
    expect(content[1]).toEqual({ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAAA' }, role: 'reference_image' });
    expect(content[3]).toEqual({ type: 'image_url', image_url: { url: 'asset://asset-1' }, role: 'reference_image' });
  });

  it('没有参考图时不传 omni_reference_task_type', () => {
    const compiled = provider.compile(spec({ references: [] }));
    expect(compiled.params.omni_reference_task_type).toBeUndefined();
  });

  it('解析官方查询返回示例', () => {
    // 来自火山方舟视频生成教程中的返回示例
    const status = parseArkTask({
      id: 'cgt-2026',
      status: 'succeeded',
      content: { video_url: 'https://ark-content-generation.example/xxx' },
      usage: { completion_tokens: 246840, total_tokens: 246840 },
      seed: 58944,
    });
    expect(status).toMatchObject({ state: 'succeeded', resultRef: 'https://ark-content-generation.example/xxx', seed: 58944 });
    expect(parseArkTask({ id: 'x', status: 'failed', error: { code: 'E', message: 'm' } }).error).toEqual({ code: 'E', message: 'm' });
    expect(mapArkStatus('queued')).toBe('queued');
    expect(mapArkStatus('running')).toBe('running');
    expect(mapArkStatus('expired')).toBe('unknown');
  });
});
