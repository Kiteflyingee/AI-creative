import { Toast } from 'antd-mobile';

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
};

/** 统一的错误提示 */
export function showError(err: unknown) {
  const message = err instanceof Error ? err.message : '操作失败';
  Toast.show({ content: message, duration: 3000 });
}

export function newIdempotencyKey() {
  return `${Date.now()}-${crypto.getRandomValues(new Uint32Array(2)).join('-')}`;
}
