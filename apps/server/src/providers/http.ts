import { ProviderError } from '../common/errors';

export interface HttpJsonOptions {
  provider: string;
  method?: 'GET' | 'POST' | 'DELETE';
  url: string;
  apiKey: string;
  body?: unknown;
  timeoutMs: number;
}

/** 调用供应商 JSON 接口，把错误统一映射为 ProviderError；不在错误或日志中输出密钥和请求体 */
export async function httpJson<T>(opts: HttpJsonOptions): Promise<T> {
  if (!opts.apiKey) {
    throw new ProviderError(opts.provider, 'MISSING_API_KEY', `${opts.provider} 未配置 API Key（.env）`, false);
  }
  let res: Response;
  try {
    res = await fetch(opts.url, {
      method: opts.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: AbortSignal.timeout(opts.timeoutMs),
    });
  } catch (err) {
    const timeout = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
    throw new ProviderError(
      opts.provider,
      timeout ? 'TIMEOUT' : 'NETWORK',
      timeout ? `${opts.provider} 请求超时` : `${opts.provider} 网络错误：${(err as Error).message}`,
      true,
    );
  }
  const text = await res.text();
  let json: unknown = undefined;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  if (!res.ok) {
    const errObj = (json as { error?: { code?: string; message?: string } } | undefined)?.error;
    const code = errObj?.code ?? `HTTP_${res.status}`;
    const message = errObj?.message ?? text.slice(0, 300);
    const retryable = res.status === 429 || res.status >= 500;
    throw new ProviderError(opts.provider, code, `${opts.provider}：${message}`, retryable, res.status);
  }
  return json as T;
}

/** 下载远端文件（视频、图片结果） */
export async function httpDownload(url: string, timeoutMs: number): Promise<Buffer> {
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    throw new ProviderError('download', 'NETWORK', `下载失败：${(err as Error).message}`, true);
  }
  if (!res.ok) {
    throw new ProviderError('download', `HTTP_${res.status}`, `下载失败：HTTP ${res.status}`, res.status >= 500 || res.status === 429, res.status);
  }
  return Buffer.from(await res.arrayBuffer());
}
