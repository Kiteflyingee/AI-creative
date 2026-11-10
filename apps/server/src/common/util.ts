import { createHash, randomBytes } from 'node:crypto';

export const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');

export const randomToken = (bytes = 24) => randomBytes(bytes).toString('base64url');

export const shortId = (prefix: string) => `${prefix}_${randomBytes(6).toString('hex')}`;

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 稳定的 JSON 序列化（键排序），用于计算哈希 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/** BigInt 不能直接 JSON 序列化 */
export function jsonSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))) as T;
}
