/**
 * 测试专用的假供应商（D-31）：只存在于测试代码中，不调用任何付费接口。
 * - FakeLlm：按调用用途返回固定 JSON，可在单个测试中覆盖
 * - FakeVideoProvider：使用真实适配器的提示词编译（Seedance / Gemini Omni）；任务按脚本推进，结果是 FFmpeg 生成的纯色视频
 * - FakeImageProvider：生成纯色图片
 * - FakeProviderFactory：替换真实适配器工厂，每个模型一个假供应商
 * - FakeComposer：用 FFmpeg 拼接代替 Remotion（Remotion 渲染另有单独测试）
 * - InlineJobQueue：在测试进程内顺序执行后台任务
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import type { CompositionInput } from '@ai-creative/shared';
import { ProviderError } from '../src/common/errors';
import { concatClips, generateTestVideo } from '../src/media/ffmpeg';
import { createVideoAdapter } from '../src/providers/factory';
import { httpDownload } from '../src/providers/http';
import { imageCapability, videoCapability } from '../src/providers/registry';
import type {
  Composer,
  ImageGenerateRequest,
  ImageGenerateResult,
  ImageModelCapability,
  ImageProvider,
  LlmProvider,
  LlmPurpose,
  LlmRequest,
  ProviderFactory,
  ShotRenderSpec,
  VideoCreateRequest,
  VideoModelCapability,
  VideoProvider,
  VideoTaskStatus,
} from '../src/providers/types';
import type { StorageService } from '../src/storage/storage.service';

type Handler = (req: LlmRequest) => unknown;

export class FakeLlm implements LlmProvider {
  readonly modelId = 'fake-llm';
  readonly calls: LlmRequest[] = [];
  private readonly overrides = new Map<LlmPurpose, Handler[]>();

  /** 覆盖某个用途的输出；传多个时依次使用（用于测试校验失败后的重试） */
  on(purpose: LlmPurpose, ...handlers: Handler[]) {
    this.overrides.set(purpose, handlers);
  }

  reset() {
    this.overrides.clear();
    this.calls.length = 0;
  }

  async complete(req: LlmRequest) {
    this.calls.push(req);
    const queue = this.overrides.get(req.purpose);
    const handler = queue && queue.length > 1 ? queue.shift()! : queue?.[0];
    const out = handler ? handler(req) : defaultLlm(req);
    return { content: typeof out === 'string' ? out : JSON.stringify(out) };
  }
}

export function defaultStorylines(factKey = 'F1') {
  const types = ['product_share', 'drama', 'host_talk', 'brand_film'];
  return {
    storylines: types.map((type, i) => ({
      title: `测试故事线${i + 1}`,
      type,
      style: '日系清新，色调偏暖',
      durationSec: i < 2 ? 15 : 30,
      hook: '开场展示痛点',
      audience: '年轻上班族',
      segments:
        i < 2
          ? [
              { startSec: 0, endSec: 3, content: '痛点开场' },
              { startSec: 3, endSec: 15, content: '展示商品' },
            ]
          : [
              { startSec: 0, endSec: 5, content: '痛点开场' },
              { startSec: 5, endSec: 30, content: '展示商品' },
            ],
      sellingPointIds: [factKey],
    })),
  };
}

function defaultLlm(req: LlmRequest): unknown {
  switch (req.purpose) {
    case 'inspect_image':
      return { hasHumanFace: false, quality: 'good', issues: [], viewRole: '正面', description: '白底商品图' };
    case 'analyze_product':
      return {
        productName: '灰色可拆洗猫窝',
        category: '宠物用品',
        sellingPoints: [{ text: '外罩可拆洗', basis: '商家描述' }],
        images: [{ index: 1, viewRole: '正面', quality: 'good', issues: [], hasHumanFace: false, description: '灰色猫窝正面' }],
        missingInfo: ['缺少细节图'],
        suggestions: ['补一张细节图'],
      };
    case 'storylines':
      return defaultStorylines();
    case 'storyboard': {
      const n = Number(/建议 (\d+) 个/.exec(req.user)?.[1] ?? 3);
      return {
        styleProfile: '日系清新，柔和自然光',
        voiceProfile: '温柔亲切的年轻女声',
        characters: [{ key: 'C9', name: '小雅', description: '25 岁女性', imagePrompt: '高质量摄影，25 岁女性，半身，9:16 竖屏' }],
        scenes: [{ key: 'S9', name: '客厅', description: '明亮客厅', imagePrompt: '高质量摄影，明亮客厅，9:16 竖屏' }],
        shots: Array.from({ length: n }, (_, i) => ({
          purpose: i === 0 ? '开场钩子' : '卖点展示',
          durationSec: 5,
          subject: '商品与人物小雅',
          videoType: '好物分享短视频',
          camera: '镜头缓慢推近',
          action: `动作${i + 1}`,
          scene: '明亮客厅',
          narration: `口播${i + 1}`,
          caption: `字幕${i + 1}`,
          consistency: '',
          refs: ['P1', 'C9', 'S9'],
        })),
      };
    }
    case 'rewrite_image_prompt':
      return { imagePrompt: '改写后的图片提示词，9:16 竖屏' };
    case 'describe_person':
      return { imagePrompt: '高质量摄影，30 岁左右女性，短发，9:16 竖屏半身' };
    case 'compare_product_image':
      return { consistent: 'pass', issues: [] };
    case 'qc':
      return { productConsistency: 'pass', unexpectedText: false, issues: [], notes: '' };
    case 'chat_edit':
      return { reply: '没有理解', operations: [], clarification: '请说得具体一些' };
  }
}

export type TaskPlan = 'succeed' | 'fail' | 'face_reject' | 'submit_retryable' | 'submit_fatal' | 'no_url' | 'stuck';

interface FakeTask {
  id: string;
  req: VideoCreateRequest;
  plan: TaskPlan;
  polls: number;
  cancelled: boolean;
  url?: string;
}

/**
 * 假视频供应商：提示词与请求参数用真实适配器编译（Seedance 或 Gemini Omni），任务按脚本推进。
 * 每个模型一个实例，任务 ID 带上模型前缀，便于区分。
 */
export class FakeVideoProvider implements VideoProvider {
  private readonly real: VideoProvider;
  readonly tasks: FakeTask[] = [];
  readonly createAttempts: VideoCreateRequest[] = [];
  readonly cleaned: string[] = [];
  /** 依次用于后续 createTask 的计划；用完后默认成功 */
  plans: TaskPlan[] = [];
  /** 排队、生成各需要的轮询次数 */
  pollsQueued = 1;
  pollsRunning = 1;
  getCalls = 0;

  constructor(
    private readonly storage: StorageService,
    readonly capability: VideoModelCapability,
  ) {
    this.real = createVideoAdapter(capability);
  }

  private get prefix() {
    return this.capability.provider === 'volcengine-ark' ? 'cgt-fake' : `${this.capability.key}-fake`;
  }

  reset() {
    this.tasks.length = 0;
    this.createAttempts.length = 0;
    this.cleaned.length = 0;
    this.plans = [];
    this.getCalls = 0;
    this.pollsQueued = 1;
    this.pollsRunning = 1;
  }

  compile(spec: ShotRenderSpec) {
    return this.real.compile(spec);
  }

  async createTask(req: VideoCreateRequest) {
    this.createAttempts.push(req);
    const plan = this.plans.shift() ?? 'succeed';
    if (plan === 'submit_retryable') throw new ProviderError('seedance', 'HTTP_429', '请求过多', true, 429);
    if (plan === 'submit_fatal') throw new ProviderError('seedance', 'InvalidParameter', '参数错误', false, 400);
    const task: FakeTask = { id: `${this.prefix}-${this.tasks.length + 1}`, req, plan, polls: 0, cancelled: false };
    this.tasks.push(task);
    return { providerTaskId: task.id };
  }

  async getTask(id: string): Promise<VideoTaskStatus> {
    this.getCalls++;
    const task = this.tasks.find((t) => t.id === id);
    if (!task) throw new ProviderError('seedance', 'NotFound', 'not found', false, 404);
    if (task.cancelled) return { state: 'cancelled', rawStatus: 'cancelled' };
    task.polls++;
    if (task.plan === 'stuck' || task.polls <= this.pollsQueued) return { state: 'queued', rawStatus: 'queued' };
    if (task.polls <= this.pollsQueued + this.pollsRunning) return { state: 'running', rawStatus: 'running' };
    if (task.plan === 'fail') return { state: 'failed', rawStatus: 'failed', error: { code: 'InternalError', message: '模型内部错误' } };
    if (task.plan === 'face_reject') {
      return { state: 'failed', rawStatus: 'failed', error: { code: 'InputImageSensitiveContentDetected.PrivacyInformation', message: 'image contains real person face' } };
    }
    if (task.plan === 'no_url') return { state: 'succeeded', rawStatus: 'succeeded' };
    if (!task.url) task.url = await this.renderVideo(task);
    return { state: 'succeeded', rawStatus: 'succeeded', resultRef: task.url, usage: { completion_tokens: 1000 }, seed: 42 };
  }

  async cancelTask(id: string): Promise<'cancelled' | 'not_cancellable'> {
    const task = this.tasks.find((t) => t.id === id);
    if (!task || task.polls > this.pollsQueued) return 'not_cancellable';
    task.cancelled = true;
    return 'cancelled';
  }

  downloadResult(resultRef: string): Promise<Buffer> {
    return httpDownload(resultRef, 60_000);
  }

  async cleanup(id: string) {
    this.cleaned.push(id);
  }

  private async renderVideo(task: FakeTask): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'fake-video-'));
    try {
      const file = join(dir, 'v.mp4');
      const colors = ['red', 'green', 'blue', 'orange', 'purple', 'cyan'];
      // 故意输出与目标不同的尺寸，检验转存时的规范化
      await generateTestVideo(file, {
        width: 320,
        height: 568,
        durationSec: task.req.compiled.durationSec,
        color: colors[this.tasks.indexOf(task) % colors.length]!,
      });
      const key = `fake-provider/${task.id}.mp4`;
      await this.storage.putBuffer(key, await readFile(file), 'video/mp4');
      return this.storage.internalUrl(key, 3600);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}

export class FakeImageProvider implements ImageProvider {
  readonly calls: ImageGenerateRequest[] = [];
  fail = false;

  constructor(readonly capability: ImageModelCapability) {}

  async generate(req: ImageGenerateRequest): Promise<ImageGenerateResult> {
    this.calls.push(req);
    if (this.fail) throw new ProviderError('fake-image', 'InternalError', '生成失败', false, 500);
    const image = sharp({ create: { width: 576, height: 1024, channels: 3, background: '#88aacc' } });
    // Gemini 图片模型返回 PNG，火山返回 JPEG
    if (this.capability.provider === 'google-gemini') return { data: await image.png().toBuffer(), mime: 'image/png' };
    return { data: await image.jpeg().toBuffer(), mime: 'image/jpeg' };
  }
}

/** 替换真实适配器的工厂：每个模型键名一个假供应商实例 */
export class FakeProviderFactory implements ProviderFactory {
  private readonly videos = new Map<string, FakeVideoProvider>();
  private readonly images = new Map<string, FakeImageProvider>();

  constructor(private readonly storage: StorageService) {}

  video(cap: VideoModelCapability): FakeVideoProvider {
    let v = this.videos.get(cap.key);
    if (!v) {
      v = new FakeVideoProvider(this.storage, cap);
      this.videos.set(cap.key, v);
    }
    return v;
  }

  image(cap: ImageModelCapability): FakeImageProvider {
    let i = this.images.get(cap.key);
    if (!i) {
      i = new FakeImageProvider(cap);
      this.images.set(cap.key, i);
    }
    return i;
  }

  videoFor(key: string) {
    return this.video(videoCapability(key));
  }

  imageFor(key: string) {
    return this.image(imageCapability(key));
  }

  reset() {
    for (const v of this.videos.values()) v.reset();
    for (const i of this.images.values()) {
      i.calls.length = 0;
      i.fail = false;
    }
  }
}

export class FakeComposer implements Composer {
  readonly renders: CompositionInput[] = [];

  async render(input: CompositionInput, outFile: string) {
    this.renders.push(input);
    await concatClips(
      input.clips.map((c) => c.src),
      outFile,
    );
  }
}

export { InlineJobQueue } from '../src/queue/inline.queue';
