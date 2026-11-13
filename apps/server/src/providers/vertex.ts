import { GoogleAuth } from 'google-auth-library';
import { ProviderError } from '../common/errors';
import { getEnv } from '../config/env';
import { toJpeg } from '../media/image';
import { httpDownload, httpJson, type HttpJsonOptions } from './http';
import type { ImageInput } from './types';

export const VERTEX_PROVIDER = 'google-vertex';
// ADC 自动发现本地 gcloud、服务账号或运行环境身份，并自动刷新 access token。
const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });

export function vertexBase(version: 'v1' | 'v1beta1' = 'v1'): string {
  const env = getEnv();
  if (!env.VERTEX_PROJECT_ID) {
    throw new ProviderError(VERTEX_PROVIDER, 'MISSING_PROJECT', '请配置 VERTEX_PROJECT_ID，并为该 Google Cloud 项目启用 Vertex AI API', false);
  }
  return `https://aiplatform.googleapis.com/${version}/projects/${encodeURIComponent(env.VERTEX_PROJECT_ID)}/locations/${env.VERTEX_LOCATION}`;
}

export async function vertexAccessToken(): Promise<string> {
  try {
    const token = await auth.getAccessToken();
    if (token) return token;
  } catch {
    // 凭据错误可能包含文件内容或敏感信息，不把 SDK 原始错误写进日志或下发前端。
  }
  throw new ProviderError(VERTEX_PROVIDER, 'AUTH_FAILED', 'Vertex AI 认证失败：请配置应用默认凭据（ADC），例如运行 gcloud auth application-default login', false);
}

export async function vertexCall<T>(opts: Omit<HttpJsonOptions, 'provider' | 'apiKey'>): Promise<T> {
  const url = new URL(opts.url);
  if (url.origin !== 'https://aiplatform.googleapis.com' || url.username || url.password) {
    throw new ProviderError(VERTEX_PROVIDER, 'BAD_API_URI', 'Vertex AI 请求地址无效', false);
  }
  return httpJson<T>({
    ...opts,
    headers: { ...opts.headers, 'x-goog-user-project': getEnv().VERTEX_PROJECT_ID },
    provider: VERTEX_PROVIDER,
    apiKey: await vertexAccessToken(),
  });
}

/** 视频使用内联结果；仍支持官方返回的 Google Cloud 文件引用，拒绝把凭据发到其他域名。 */
export async function downloadVertexFile(uri: string, timeoutMs: number): Promise<Buffer> {
  let url: URL;
  try {
    url = new URL(uri);
    if (url.protocol === 'gs:' && url.hostname && url.pathname.length > 1 && !url.search && !url.hash) {
      url = new URL(`https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(url.hostname)}/o/${encodeURIComponent(decodeURIComponent(url.pathname.slice(1)))}?alt=media`);
    }
    if (url.protocol !== 'https:' || url.username || url.password || url.port ||
      !['aiplatform.googleapis.com', 'storage.googleapis.com'].includes(url.hostname)) throw new Error('invalid');
  } catch {
    throw new ProviderError(VERTEX_PROVIDER, 'BAD_RESULT_URI', 'Vertex AI 返回的文件地址不是受支持的 Google Cloud 地址，已拒绝下载', false);
  }
  return httpDownload(url.toString(), timeoutMs, { Authorization: `Bearer ${await vertexAccessToken()}` }, 'error');
}

export function vertexInteractionCall<T>(opts: Omit<HttpJsonOptions, 'provider' | 'apiKey' | 'headers'>): Promise<T> {
  const revision = getEnv().VERTEX_API_REVISION;
  return vertexCall<T>({ ...opts, headers: revision ? { 'Api-Revision': revision } : undefined });
}

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
  outputs?: InteractionContent[];
  usage?: unknown;
  error?: { code?: string | number; status?: string; message?: string };
}

export function modelOutputs(res: InteractionResponse | undefined): InteractionContent[] {
  if (!res) return [];
  const parts = (res.steps ?? []).filter((s) => s.type === 'model_output').flatMap((s) => s.content ?? []);
  return parts.length ? parts : (res.outputs ?? []);
}

export function outputText(res: InteractionResponse | undefined): string {
  return modelOutputs(res).filter((c) => c.type === 'text' && c.text).map((c) => c.text!).join(' ').trim();
}

/** 商家图片一律内联发送；虚拟人像只属于火山，不发送给 Vertex。 */
export async function toVertexInteractionImagePart(image: ImageInput): Promise<InteractionContent> {
  switch (image.kind) {
    case 'base64':
      return { type: 'image', data: image.data, mime_type: image.mime };
    case 'url': {
      const jpeg = await toJpeg(await httpDownload(image.url, 120_000), 2048, 90);
      return { type: 'image', data: jpeg.toString('base64'), mime_type: 'image/jpeg' };
    }
    case 'asset':
      throw new ProviderError(VERTEX_PROVIDER, 'NOT_SUPPORTED', '虚拟人像只能用于火山的视频模型，请换成 AI 相似人物或不用这张图', false);
  }
}

export interface VertexPart {
  text?: string;
  thought?: boolean;
  inlineData?: { data: string; mimeType: string };
}

export interface VertexContentResponse {
  candidates?: Array<{ content?: { parts?: VertexPart[] }; finishReason?: string }>;
  promptFeedback?: { blockReason?: string };
  usageMetadata?: unknown;
}

export async function toVertexImagePart(image: ImageInput): Promise<VertexPart> {
  const part = await toVertexInteractionImagePart(image);
  return { inlineData: { data: part.data!, mimeType: part.mime_type! } };
}

export function vertexModelUrl(model: string): string {
  return `${vertexBase()}/publishers/google/models/${encodeURIComponent(model)}:generateContent`;
}
