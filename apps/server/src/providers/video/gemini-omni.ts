import { ProviderError } from '../../common/errors';
import {
  downloadGeminiFile,
  GEMINI_PROVIDER,
  geminiBase,
  geminiCall,
  modelOutputs,
  outputText,
  toGeminiImagePart,
  type InteractionResponse,
} from '../gemini';
import type {
  CompiledVideoRequest,
  ImageSourceRef,
  ShotRenderSpec,
  VideoCreateRequest,
  VideoModelCapability,
  VideoProvider,
  VideoTaskState,
  VideoTaskStatus,
} from '../types';

/**
 * 去掉商家文字里会破坏提示词结构的符号：引号（台词用引号包裹）、尖括号（Omni 已废弃的控制标签）、
 * 各类括号与 @，并把换行合并成空格。
 */
export function sanitizeOmniText(input: string): string {
  return input
    .replace(/["“”<>《》{}【】[\]@「」]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 去掉句末标点后补一个英文句号，避免中英文标点叠在一起 */
function clause(text: string): string {
  const t = sanitizeOmniText(text).replace(/[。．.!！?？；;，,、\s]+$/u, '');
  return t ? `${t}.` : '';
}

function bare(text: string): string {
  return sanitizeOmniText(text).replace(/[。．.!！?？；;，,、\s]+$/u, '');
}

const PRIORITY = (r: ShotRenderSpec['references'][number]) =>
  r.kind === 'product' ? (r.role === 'primary' ? 0 : 1) : r.kind === 'character' ? 2 : 3;

/** 官方：最多 2 个角色（每个最多 3 张），合计最多 6 张参考图 */
const MAX_CHARACTERS_WITH_IMAGE = 2;

/**
 * Gemini Omni 提示词编译器（确定性：同一输入输出完全相同）。
 * - 英文模板（官方只对英文做了完整评估）；商家与故事板里的中文内容原样放入
 * - 要求单个连续镜头（Omni 默认会自己切镜头）
 * - 参考图按“商品 → 商品原图 → 人物 → 场景”编号，用自然语言说明用途，不用控制标签
 * - 超出上限的参考图改为文字描述
 * - 口播逐字给出；不写任何背景音乐要求（D-13）；要求不渲染字幕和叠加文字（D-17）
 */
export function compileOmniPrompt(spec: ShotRenderSpec, maxImages: number): { prompt: string; images: ImageSourceRef[] } {
  const refs = [...spec.references].sort((a, b) => PRIORITY(a) - PRIORITY(b));
  const images: ImageSourceRef[] = [];
  const imageLines: string[] = [];
  const textLines: string[] = [];
  let charactersWithImage = 0;

  for (const ref of refs) {
    const name = bare(ref.name);
    const desc = bare(ref.description);
    const detail = desc ? ` (${desc})` : '';
    const isCharacter = ref.kind === 'character';
    const fits = images.length < maxImages && (!isCharacter || charactersWithImage < MAX_CHARACTERS_WITH_IMAGE);
    if (ref.image && fits) {
      images.push(ref.image);
      if (isCharacter) charactersWithImage++;
      const n = images.length;
      if (ref.kind === 'product') {
        imageLines.push(
          ref.role === 'original_detail'
            ? `- Image ${n}: the original photo of the product "${name}". Match its exact appearance details.`
            : `- Image ${n}: the product "${name}"${detail}.`,
        );
      } else if (isCharacter) {
        imageLines.push(`- Image ${n}: the character "${name}"${detail}.`);
      } else {
        imageLines.push(`- Image ${n}: the setting "${name}"${detail}.`);
      }
    } else if (ref.role === 'primary') {
      const label = ref.kind === 'product' ? 'Product' : isCharacter ? 'Character' : 'Setting';
      textLines.push(`- ${label} "${name}"${desc ? `: ${desc}` : ''}.`);
    }
  }

  const f = spec.fields;
  const lines: string[] = ['A single continuous shot with no scene cuts. Vertical 9:16 short video clip for e-commerce.'];
  if (imageLines.length) {
    lines.push('Reference images (use them only to keep appearance consistent; they are not frames of the video):', ...imageLines);
  }
  if (textLines.length) lines.push('Described without a reference image:', ...textLines);
  if (bare(f.subject)) lines.push(`Subject: ${clause(f.subject)}`);
  if (bare(f.videoType)) lines.push(`Video type: ${clause(f.videoType)}`);
  if (bare(f.camera)) lines.push(`Camera: ${clause(f.camera)}`);
  if (bare(f.action)) lines.push(`Action: ${clause(f.action)}`);
  if (bare(f.scene)) lines.push(`Setting: ${clause(f.scene)}`);

  const narration = bare(f.narration);
  const voice = bare(spec.voiceProfile);
  if (narration) {
    const language = /[\u3400-\u9fff]/u.test(narration) ? ' in Mandarin Chinese' : '';
    lines.push(
      `Speech:${voice ? ` voice is ${voice}.` : ''} Say exactly this line${language}, once, without adding or changing any words: "${narration}"`,
    );
  } else {
    lines.push('Speech: no dialogue and no voiceover.');
  }

  const consistency: string[] = [];
  if (refs.some((r) => r.kind === 'product')) {
    consistency.push("the product's shape, colors, materials, printed text and logo exactly match the reference images");
  }
  if (refs.some((r) => r.kind === 'character' && r.image)) consistency.push("the character's face, hairstyle and outfit match the reference image");
  const extra = bare(f.consistency);
  if (extra) consistency.push(extra);
  const style = bare(spec.styleProfile);
  if (style) consistency.push(`overall style: ${style}`);
  consistency.push('do not add unrelated objects');
  lines.push(`Consistency: ${consistency.join('; ')}.`);
  lines.push('Do not render subtitles, captions or any overlay text.');

  return { prompt: lines.join('\n'), images };
}

const KNOWN_STATES: Record<string, VideoTaskState> = {
  queued: 'queued',
  pending: 'queued',
  in_progress: 'running',
  completed: 'succeeded',
  failed: 'failed',
  incomplete: 'failed',
  cancelled: 'cancelled',
  canceled: 'cancelled',
};

export function mapInteractionStatus(raw: string | undefined): VideoTaskState {
  return (raw && KNOWN_STATES[raw]) || 'unknown';
}

/** 解析 GET /interactions/{id}。结果视频以 Base64 内联返回时不放进状态里，转存时再取 */
export function parseInteraction(res: InteractionResponse, id: string): VideoTaskStatus {
  const state = mapInteractionStatus(res.status);
  const rawStatus = res.status ?? 'missing';
  if (state === 'succeeded') {
    const video = modelOutputs(res).find((c) => c.type === 'video' && (c.data || c.uri));
    if (!video) {
      const text = outputText(res).slice(0, 200);
      return {
        state: 'failed',
        rawStatus,
        usage: res.usage,
        error: { code: 'NO_VIDEO', message: `视频模型没有返回视频${text ? `：${text}` : ''}` },
      };
    }
    return { state, rawStatus, usage: res.usage, resultRef: video.data ? `interaction:${id}` : video.uri };
  }
  if (state === 'failed') {
    const code = typeof res.error?.code === 'string' ? res.error.code : (res.error?.status ?? (rawStatus === 'incomplete' ? 'INCOMPLETE' : 'FAILED'));
    const message = res.error?.message ?? (outputText(res).slice(0, 200) || '视频生成失败');
    return { state, rawStatus, usage: res.usage, error: { code, message } };
  }
  return { state, rawStatus, usage: res.usage };
}

/**
 * Gemini Omni 适配器（Interactions API，后台执行）：
 * POST /interactions（background=true）→ GET /interactions/{id} 轮询 → POST /interactions/{id}/cancel 取消；
 * 转存成功后 DELETE /interactions/{id}，不在 Google 保留商家的图片与视频。
 */
export class GeminiOmniProvider implements VideoProvider {
  constructor(readonly capability: VideoModelCapability) {}

  compile(spec: ShotRenderSpec): CompiledVideoRequest {
    const { prompt, images } = compileOmniPrompt(spec, this.capability.maxReferenceImages);
    return {
      prompt,
      images,
      durationSec: spec.durationSec,
      params: { aspect_ratio: spec.aspectRatio, resolution: spec.resolution, duration: `${spec.durationSec}s` },
    };
  }

  async buildBody(req: VideoCreateRequest): Promise<Record<string, unknown>> {
    const parts = await Promise.all(req.images.map((img) => toGeminiImagePart(img)));
    return {
      model: this.capability.modelId,
      input: [...parts, { type: 'text', text: req.compiled.prompt }],
      response_format: { type: 'video', ...req.compiled.params },
      background: true,
    };
  }

  async createTask(req: VideoCreateRequest): Promise<{ providerTaskId: string }> {
    const body = await this.buildBody(req);
    let res: InteractionResponse;
    try {
      res = await geminiCall<InteractionResponse>({ method: 'POST', url: `${geminiBase()}/interactions`, body, timeoutMs: 120_000 });
    } catch (err) {
      // 请求已经发出但没有等到返回：无法确认是否已创建任务，不自动重试，避免重复生成
      if (err instanceof ProviderError && err.code === 'TIMEOUT') {
        throw new ProviderError(GEMINI_PROVIDER, 'SUBMIT_UNKNOWN', '提交视频任务超时，无法确认是否已创建任务', false);
      }
      throw err;
    }
    if (!res?.id) throw new ProviderError(GEMINI_PROVIDER, 'BAD_RESPONSE', 'Gemini 未返回任务 ID', false);
    return { providerTaskId: res.id };
  }

  async getTask(providerTaskId: string): Promise<VideoTaskStatus> {
    const res = await geminiCall<InteractionResponse>({
      url: `${geminiBase()}/interactions/${encodeURIComponent(providerTaskId)}`,
      timeoutMs: 120_000,
    });
    return parseInteraction(res, providerTaskId);
  }

  async cancelTask(providerTaskId: string): Promise<'cancelled' | 'not_cancellable'> {
    try {
      await geminiCall({
        method: 'POST',
        url: `${geminiBase()}/interactions/${encodeURIComponent(providerTaskId)}/cancel`,
        timeoutMs: 30_000,
      });
      return 'cancelled';
    } catch (err) {
      if (err instanceof ProviderError && !err.retryable) return 'not_cancellable';
      throw err;
    }
  }

  async downloadResult(resultRef: string, providerTaskId: string): Promise<Buffer> {
    if (!resultRef.startsWith('interaction:')) return downloadGeminiFile(resultRef, 10 * 60_000);
    const res = await geminiCall<InteractionResponse>({
      url: `${geminiBase()}/interactions/${encodeURIComponent(providerTaskId)}`,
      timeoutMs: 10 * 60_000,
    });
    const video = modelOutputs(res).find((c) => c.type === 'video' && (c.data || c.uri));
    if (video?.data) {
      const data = Buffer.from(video.data, 'base64');
      if (!data.length) throw new ProviderError(GEMINI_PROVIDER, 'EMPTY_VIDEO', 'Gemini 返回的视频为空', false);
      return data;
    }
    if (video?.uri) return downloadGeminiFile(video.uri, 10 * 60_000);
    throw new ProviderError(GEMINI_PROVIDER, 'NO_VIDEO', 'Gemini 结果里没有视频', false);
  }

  async cleanup(providerTaskId: string): Promise<void> {
    await geminiCall({
      method: 'DELETE',
      url: `${geminiBase()}/interactions/${encodeURIComponent(providerTaskId)}`,
      timeoutMs: 30_000,
    });
  }
}
