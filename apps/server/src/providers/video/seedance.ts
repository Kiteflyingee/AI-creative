import { getEnv } from '../../config/env';
import { ProviderError } from '../../common/errors';
import { httpJson } from '../http';
import {
  imageInputToUrl,
  type CompiledVideoRequest,
  type ImageSourceRef,
  type ShotRenderSpec,
  type VideoCreateRequest,
  type VideoModelCapability,
  type VideoProvider,
  type VideoTaskState,
  type VideoTaskStatus,
} from '../types';

/**
 * 去掉商家文字里会改变 Seedance 提示词语义的符号：
 * {} 表示台词、【】表示字幕、() 表示音乐、<> 表示音效（Seedance 2.5 提示词指南），@ 用于引用素材，「」是本模板的名称引号。
 */
export function sanitizePromptText(input: string): string {
  return input
    .replace(/[{}【】()（）<>《》@「」[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function sentence(text: string): string {
  const t = sanitizePromptText(text);
  if (!t) return '';
  return /[。！？.!?]$/.test(t) ? t : `${t}。`;
}

const ROLE_ORDER: Record<string, number> = { product: 0, character: 1, scene: 2 };

/**
 * 按 Kickart 视频提示词公式编译：参考图主体 + 视频类型 + 运镜 + 主体动作 + 场景环境 + 口播/音频 + 一致性约束。
 * 口播用 {} 包裹（Seedance 台词语法）；结尾要求不生成字幕和水印（字幕在合成阶段叠加，D-17）。
 * 不写任何背景音乐要求（D-13）。确定性：同一输入输出完全相同。
 */
export function compileSeedancePrompt(spec: ShotRenderSpec): { prompt: string; images: ImageSourceRef[] } {
  const refs = [...spec.references].sort((a, b) => {
    const k = (ROLE_ORDER[a.kind] ?? 9) - (ROLE_ORDER[b.kind] ?? 9);
    if (k !== 0) return k;
    if (a.role !== b.role) return a.role === 'primary' ? -1 : 1;
    return 0;
  });

  const images: ImageSourceRef[] = [];
  const subjectParts: string[] = [];
  const textOnly: string[] = [];
  for (const ref of refs) {
    const name = sanitizePromptText(ref.name);
    const desc = sanitizePromptText(ref.description);
    if (ref.image) {
      images.push(ref.image);
      const tag = `@图像${images.length}`;
      if (ref.kind === 'product') {
        subjectParts.push(
          ref.role === 'original_detail'
            ? `${tag} 是商品「${name}」的原始实拍图，用于还原外观细节`
            : `${tag} 是商品「${name}」${desc ? `（${desc}）` : ''}`,
        );
      } else if (ref.kind === 'character') {
        subjectParts.push(`${tag} 是人物「${name}」${desc ? `（${desc}）` : ''}`);
      } else {
        subjectParts.push(`${tag} 是场景「${name}」${desc ? `（${desc}）` : ''}`);
      }
    } else if (ref.role === 'primary') {
      const label = ref.kind === 'product' ? '商品' : ref.kind === 'character' ? '人物' : '场景';
      textOnly.push(`${label}「${name}」${desc ? `：${desc}` : ''}`);
    }
  }

  const f = spec.fields;
  const lines: string[] = [];
  const subject = [subjectParts.join('；'), textOnly.join('；'), sanitizePromptText(f.subject)].filter(Boolean);
  if (subject.length) lines.push(`参考图主体：${subject.join('。')}${/[。]$/.test(subject.join('')) ? '' : '。'}`);
  if (f.videoType) lines.push(`视频类型：${sentence(f.videoType)}`);
  if (f.camera) lines.push(`运镜方式：${sentence(f.camera)}`);
  if (f.action) lines.push(`主体动作：${sentence(f.action)}`);
  if (f.scene) lines.push(`场景环境：${sentence(f.scene)}`);

  const narration = sanitizePromptText(f.narration);
  const voice = sanitizePromptText(spec.voiceProfile);
  if (narration) {
    lines.push(`口播/音频：${voice ? `${voice}，` : ''}口播：{${narration}}。严格按台词生成口播，不增减台词。`);
  } else {
    lines.push('口播/音频：本镜头无口播。');
  }

  const consistency: string[] = [];
  if (refs.some((r) => r.kind === 'product')) consistency.push('商品的外观、颜色、结构、文字与 Logo 与参考图严格一致');
  if (refs.some((r) => r.kind === 'character' && r.image)) consistency.push('人物五官、发型与服饰与参考图一致');
  const extra = sanitizePromptText(f.consistency);
  if (extra) consistency.push(extra.replace(/[。.]$/, ''));
  const style = sanitizePromptText(spec.styleProfile);
  if (style) consistency.push(`整体风格：${style.replace(/[。.]$/, '')}`);
  consistency.push('不新增无关元素');
  lines.push(`一致性约束：${consistency.join('；')}。`);
  lines.push('不生成字幕和水印。');

  return { prompt: lines.join('\n'), images };
}

interface ArkTaskResponse {
  id: string;
  status?: string;
  content?: { video_url?: string };
  usage?: unknown;
  seed?: number;
  error?: { code?: string; message?: string };
}

const KNOWN_STATES: Record<string, VideoTaskState> = {
  queued: 'queued',
  running: 'running',
  succeeded: 'succeeded',
  failed: 'failed',
  cancelled: 'cancelled',
  canceled: 'cancelled',
};

export function mapArkStatus(raw: string | undefined): VideoTaskState {
  return (raw && KNOWN_STATES[raw]) || 'unknown';
}

/** 火山方舟 Seedance 2.x 适配器（POST/GET/DELETE /contents/generations/tasks） */
export class SeedanceProvider implements VideoProvider {
  constructor(readonly capability: VideoModelCapability) {}

  private get base() {
    return getEnv().ARK_BASE_URL.replace(/\/$/, '');
  }

  private get apiKey() {
    return getEnv().ARK_API_KEY;
  }

  compile(spec: ShotRenderSpec): CompiledVideoRequest {
    const { prompt, images } = compileSeedancePrompt(spec);
    if (images.length > this.capability.maxReferenceImages) {
      throw new ProviderError('seedance', 'TOO_MANY_IMAGES', `参考图超过 ${this.capability.maxReferenceImages} 张`, false);
    }
    const params: Record<string, unknown> = {
      ratio: spec.aspectRatio,
      resolution: spec.resolution,
      duration: spec.durationSec,
      generate_audio: true,
      watermark: false,
    };
    // 全模态参考生视频：参考图模式可以指定 9:16（官方示例在请求体顶层传 omni_reference_task_type）
    if (images.length > 0) params.omni_reference_task_type = 'reference';
    return { prompt, images, params };
  }

  buildBody(req: VideoCreateRequest): Record<string, unknown> {
    return {
      model: this.capability.modelId,
      content: [
        { type: 'text', text: req.compiled.prompt },
        ...req.images.map((img) => ({
          type: 'image_url',
          image_url: { url: imageInputToUrl(img) },
          role: 'reference_image',
        })),
      ],
      ...req.compiled.params,
    };
  }

  async createTask(req: VideoCreateRequest): Promise<{ providerTaskId: string }> {
    const res = await httpJson<ArkTaskResponse>({
      provider: 'seedance',
      method: 'POST',
      url: `${this.base}/contents/generations/tasks`,
      apiKey: this.apiKey,
      body: this.buildBody(req),
      timeoutMs: 120_000,
    });
    if (!res?.id) throw new ProviderError('seedance', 'BAD_RESPONSE', 'Seedance 未返回任务 ID', true);
    return { providerTaskId: res.id };
  }

  async getTask(providerTaskId: string): Promise<VideoTaskStatus> {
    const res = await httpJson<ArkTaskResponse>({
      provider: 'seedance',
      url: `${this.base}/contents/generations/tasks/${encodeURIComponent(providerTaskId)}`,
      apiKey: this.apiKey,
      timeoutMs: 30_000,
    });
    return parseArkTask(res);
  }

  async cancelTask(providerTaskId: string): Promise<'cancelled' | 'not_cancellable'> {
    try {
      await httpJson({
        provider: 'seedance',
        method: 'DELETE',
        url: `${this.base}/contents/generations/tasks/${encodeURIComponent(providerTaskId)}`,
        apiKey: this.apiKey,
        timeoutMs: 30_000,
      });
      return 'cancelled';
    } catch (err) {
      if (err instanceof ProviderError && !err.retryable) return 'not_cancellable';
      throw err;
    }
  }
}

export function parseArkTask(res: ArkTaskResponse): VideoTaskStatus {
  const state = mapArkStatus(res.status);
  return {
    state,
    rawStatus: res.status ?? 'missing',
    videoUrl: res.content?.video_url,
    usage: res.usage,
    seed: typeof res.seed === 'number' ? res.seed : undefined,
    error:
      state === 'failed'
        ? { code: res.error?.code ?? 'FAILED', message: res.error?.message ?? '视频生成失败' }
        : undefined,
  };
}
