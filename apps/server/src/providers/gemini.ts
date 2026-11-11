import { ProviderError } from '../common/errors';
import { getEnv } from '../config/env';
import { toJpeg } from '../media/image';
import { httpDownload, httpJson, type HttpJsonOptions } from './http';
import type { ImageInput } from './types';

/**
 * Google Gemini API 的 Interactions 接口（Gemini Omni 视频、Nano Banana 图片共用）。
 * 文档：https://ai.google.dev/gemini-api/docs/interactions-overview
 * 密钥放在 x-goog-api-key 请求头，不放进 URL（避免出现在日志里）。
 */
export const GEMINI_PROVIDER = 'gemini';

export interface InteractionContent {
  type?: string;
  text?: string;
  data?: string;
  uri?: string;
  mime_type?: string;
}

export interface InteractionResponse {
  id?: string;
  status?: string;
  model?: string;
  steps?: Array<{ type?: string; content?: InteractionContent[] }>;
  /** 早期返回格式 */
  outputs?: InteractionContent[];
  usage?: unknown;
  error?: { code?: string | number; status?: string; message?: string };
}

export function geminiBase(): string {
  return getEnv().GEMINI_BASE_URL.replace(/\/$/, '');
}

export function geminiCall<T>(opts: Omit<HttpJsonOptions, 'provider' | 'apiKey' | 'auth' | 'headers'>): Promise<T> {
  const env = getEnv();
  return httpJson<T>({
    ...opts,
    provider: GEMINI_PROVIDER,
    apiKey: env.GEMINI_API_KEY,
    auth: 'x-goog-api-key',
    headers: env.GEMINI_API_REVISION ? { 'Api-Revision': env.GEMINI_API_REVISION } : undefined,
  });
}

/** 模型输出的全部内容块（steps 中 type=model_output 的部分；兼容早期的 outputs 字段） */
export function modelOutputs(res: InteractionResponse | undefined): InteractionContent[] {
  if (!res) return [];
  const fromSteps = (res.steps ?? []).filter((s) => s.type === 'model_output').flatMap((s) => s.content ?? []);
  return fromSteps.length ? fromSteps : (res.outputs ?? []);
}

export function outputText(res: InteractionResponse | undefined): string {
  return modelOutputs(res)
    .filter((c) => c.type === 'text' && c.text)
    .map((c) => c.text!)
    .join(' ')
    .trim();
}

/** Google 的文件下载地址需要带密钥；只给 Google 的域名发送密钥 */
export function isGoogleApiUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.hostname === new URL(geminiBase()).hostname;
  } catch {
    return false;
  }
}

export async function downloadGeminiFile(uri: string, timeoutMs: number): Promise<Buffer> {
  if (!isGoogleApiUrl(uri)) {
    throw new ProviderError(GEMINI_PROVIDER, 'BAD_RESULT_URI', 'Gemini 返回的文件地址不是 Google API 地址，已拒绝下载', false);
  }
  const key = getEnv().GEMINI_API_KEY;
  if (!key) throw new ProviderError(GEMINI_PROVIDER, 'MISSING_API_KEY', `${GEMINI_PROVIDER} 未配置 API Key（.env）`, false);
  return httpDownload(uri, timeoutMs, { 'x-goog-api-key': key });
}

/**
 * 图片转成 Interactions 的输入块：一律以 Base64 内联发送。
 * - 链接（签名 URL、Seedream 结果链接）先由服务端下载，再转 JPEG
 * - 火山虚拟人像（asset://）只能用于火山模型，这里直接报错
 */
export async function toGeminiImagePart(img: ImageInput): Promise<InteractionContent> {
  switch (img.kind) {
    case 'base64':
      return { type: 'image', data: img.data, mime_type: img.mime };
    case 'url': {
      const jpeg = await toJpeg(await httpDownload(img.url, 120_000), 2048, 90);
      return { type: 'image', data: jpeg.toString('base64'), mime_type: 'image/jpeg' };
    }
    case 'asset':
      throw new ProviderError(GEMINI_PROVIDER, 'NOT_SUPPORTED', '虚拟人像只能用于火山的视频模型，请换成 AI 相似人物或不用这张图', false);
  }
}
