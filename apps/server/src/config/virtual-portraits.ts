import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { z } from 'zod';
import { getEnv, repoPath } from './env';

const portraitSchema = z.array(
  z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string().default(''),
    previewUrl: z.string().default(''),
  }),
);
export type VirtualPortrait = z.infer<typeof portraitSchema>[number];

/** 火山预置虚拟人像清单（D-28）。文件不存在或为空时，前端不显示“换虚拟人像” */
export function loadVirtualPortraits(): VirtualPortrait[] {
  const file = getEnv().VIRTUAL_PORTRAITS_FILE;
  const path = isAbsolute(file) ? file : repoPath(file);
  if (!existsSync(path)) return [];
  try {
    return portraitSchema.parse(JSON.parse(readFileSync(path, 'utf-8')));
  } catch (err) {
    throw new Error(`虚拟人像清单格式错误（${path}）：${(err as Error).message}`);
  }
}
