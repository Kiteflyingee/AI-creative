import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

/** 仓库根目录（apps/server 的上两级） */
export const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..');

let loaded = false;
function loadEnvFile() {
  if (loaded) return;
  loaded = true;
  const file = resolve(REPO_ROOT, '.env');
  if (existsSync(file)) loadDotenv({ path: file, quiet: true });
}

const bool = z
  .string()
  .optional()
  .transform((v) => v === 'true' || v === '1');

const envSchema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().int().default(3001),
  H5_ORIGIN: z.string().default('http://localhost:5173'),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  DEV_LOGIN_ENABLED: bool,
  /** 开发时在 API 进程内同时运行后台任务 */
  WORKER_IN_PROCESS: z
    .string()
    .optional()
    .transform((v) => v !== 'false'),

  S3_ENDPOINT: z.string().default('http://localhost:9000'),
  S3_PUBLIC_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().default('ai-creative'),
  S3_ACCESS_KEY_ID: z.string().default(''),
  S3_SECRET_ACCESS_KEY: z.string().default(''),
  S3_FORCE_PATH_STYLE: bool,
  MODEL_IMAGE_TRANSPORT: z.enum(['base64', 'signed_url']).default('base64'),

  /**
   * 大模型供应商：deepseek = DeepSeek 官方；ark = 火山方舟托管的 DeepSeek；
   * openai_compatible = 任意 OpenAI 兼容接口（如 Gemini 的 OpenAI 兼容接口），用 LLM_* 配置
   */
  LLM_PROVIDER: z.enum(['deepseek', 'ark', 'openai_compatible']).default('deepseek'),
  DEEPSEEK_API_KEY: z.string().default(''),
  DEEPSEEK_BASE_URL: z.string().default('https://api.deepseek.com'),
  DEEPSEEK_MODEL: z.string().default('deepseek-flash'),
  ARK_LLM_MODEL: z.string().default('deepseek-v4-1-flash-261017'),
  LLM_BASE_URL: z.string().default(''),
  LLM_API_KEY: z.string().default(''),
  LLM_MODEL: z.string().default(''),
  /** 思考开关的写法：deepseek = thinking.type；reasoning_effort = OpenAI 写法；none = 不传 */
  LLM_THINKING_PARAM: z.enum(['deepseek', 'reasoning_effort', 'none']).default('none'),
  /** JSON 输出：json_object = response_format.type=json_object；none = 只靠提示词与校验 */
  LLM_JSON_MODE: z.enum(['json_object', 'none']).default('json_object'),

  /** 系统使用的模型组合（能力登记表键名）。新建项目时记录到项目上，之后该项目一直用这一组 */
  VIDEO_MODEL: z.string().default('gemini-omni-1.2-flash'),
  IMAGE_MODEL: z.string().default('nano-banana-2.1'),

  /** 火山方舟（国内）或 BytePlus ModelArk（海外）：两者接口相同，改地址与模型 ID 即可 */
  ARK_API_KEY: z.string().default(''),
  ARK_BASE_URL: z.string().default('https://ark.cn-beijing.volces.com/api/v3'),
  SEEDANCE_MODEL_ID: z.string().default('doubao-seedance-2-5-260628'),
  SEEDREAM_MODEL_ID: z.string().default('doubao-seedream-5-0-pro-260628'),
  /** 火山个人账号：并发 3、RPM 180（D-16） */
  ARK_VIDEO_MAX_CONCURRENCY: z.coerce.number().int().positive().default(3),
  ARK_VIDEO_RPM: z.coerce.number().int().positive().default(180),

  /** Google Gemini API（Gemini Omni 视频、Nano Banana 图片） */
  GEMINI_API_KEY: z.string().default(''),
  GEMINI_BASE_URL: z.string().default('https://generativelanguage.googleapis.com/v1beta'),
  /** Interactions API 的版本头（Api-Revision）；留空则不发送 */
  GEMINI_API_REVISION: z.string().default('2026-05-20'),
  OMNI_MODEL_ID: z.string().default('gemini-omni-1.2-flash'),
  NANO_BANANA_MODEL_ID: z.string().default('gemini-nano-banana-2.1'),
  GEMINI_VIDEO_MAX_CONCURRENCY: z.coerce.number().int().positive().default(3),
  GEMINI_VIDEO_RPM: z.coerce.number().int().positive().default(30),

  VIDEO_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(10000),
  VIDEO_TASK_TIMEOUT_MS: z.coerce.number().int().positive().default(30 * 60 * 1000),
  VIRTUAL_PORTRAITS_FILE: z.string().default('config/virtual-portraits.json'),

  /** bullmq = Redis 队列（服务运行）；inline = 进程内执行（命令行脚本） */
  JOB_QUEUE_MODE: z.enum(['bullmq', 'inline']).default('bullmq'),
  /** 临时文件目录 */
  TMP_DIR: z.string().default('.tmp'),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;
  loadEnvFile();
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`环境变量配置错误：${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/** 测试中修改环境变量后重新读取 */
export function resetEnvCache() {
  cached = null;
}

export function repoPath(...parts: string[]): string {
  return resolve(REPO_ROOT, ...parts);
}
