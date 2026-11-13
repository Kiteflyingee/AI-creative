import { Toast } from 'antd-mobile';
import { creativeStreamEventSchema, type ReportCreativeProgress } from '@ai-creative/shared';

const TOKEN_KEY = 'aic_token';
const USER_KEY = 'aic_user';

export const API_BASE: string =
  (import.meta.env.VITE_API_BASE as string | undefined) ?? `${location.protocol}//${location.hostname}:3001`;

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function getUser(): { id: string; name: string } | null {
  const raw = localStorage.getItem(USER_KEY);
  return raw ? (JSON.parse(raw) as { id: string; name: string }) : null;
}

export function setSession(token: string, user: { id: string; name: string }) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { method, headers, body: payload });
  } catch {
    throw new ApiError(0, 'NETWORK', '网络连接失败，请检查网络后重试');
  }
  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : undefined;
  if (!res.ok) {
    const err = (data ?? {}) as { code?: string; message?: string; details?: unknown };
    if (res.status === 401) {
      clearSession();
      if (!location.pathname.startsWith('/login') && !location.pathname.startsWith('/s/')) location.href = '/login';
    }
    throw new ApiError(res.status, err.code ?? `HTTP_${res.status}`, err.message ?? '请求失败', err.details);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
  upload: <T>(path: string, form: FormData) => request<T>('POST', path, form),
  postStream,
};

/** 流式展示真实阶段；断线不自动重发，避免重复创建方案或参考图。 */
async function postStream(path: string, body: unknown, onProgress: ReportCreativeProgress): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken() ?? ''}` }, body: JSON.stringify(body) });
  } catch {
    throw new ApiError(0, 'NETWORK', '连接中断，请先查看最新结果，再决定是否重新生成');
  }
  if (!res.ok) {
    const err = await res.json() as { code?: string; message?: string };
    if (res.status === 401) clearSession();
    throw new ApiError(res.status, err.code ?? `HTTP_${res.status}`, err.message ?? '请求失败');
  }
  if (!res.body || !res.headers.get('Content-Type')?.includes('application/x-ndjson')) throw new ApiError(502, 'STREAM_INVALID', '无法读取生成进度，请先查看最新结果');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const consume = (line: string): boolean => {
    if (!line.trim()) return false;
    const event = creativeStreamEventSchema.parse(JSON.parse(line));
    if (event.type === 'error') throw new ApiError(event.status, event.code, event.message);
    if (event.type === 'progress') onProgress(event.progress);
    return event.type === 'done';
  };
  try {
    for (;;) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) if (consume(line)) return;
      if (done) {
        if (buffer && consume(buffer)) return;
        throw new Error('Stream ended without done');
      }
    }
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(0, 'STREAM_INTERRUPTED', '进度连接中断，请先查看最新结果，避免重复生成');
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

/** 统一的错误提示 */
export function showError(err: unknown) {
  const message = err instanceof Error ? err.message : '操作失败';
  Toast.show({ content: message, duration: 3000 });
}

export function newIdempotencyKey() {
  return `${Date.now()}-${crypto.getRandomValues(new Uint32Array(2)).join('-')}`;
}
