/** 后台任务名称与参数 */
export interface JobPayloads {
  /** 调度：轮询进行中的视频任务、提交排队中的片段 */
  tick: Record<string, never>;
  /** 下载并规范化视频片段 */
  transfer: { clipId: string };
  /** Remotion 合成成片 */
  compose: { outputId: string };
  /** 成片质检记录 */
  qc: { outputId: string };
  /** 生成参考图（人物、场景、AI 修改商品图、相似人物） */
  image: { assetId: string };
  /** 上传图片的人脸检测与质量诊断 */
  inspect: { assetId: string };
}

export type JobName = keyof JobPayloads;

export interface EnqueueOptions {
  delayMs?: number;
  /** 去重：相同 jobId 的任务只保留一个 */
  jobId?: string;
  attempts?: number;
}

export interface JobQueue {
  enqueue<N extends JobName>(name: N, data: JobPayloads[N], opts?: EnqueueOptions): Promise<void>;
}

export const JOB_QUEUE = Symbol('JOB_QUEUE');

/** 任务失败后是否还会重试（由队列实现提供） */
export interface JobContext {
  attempt: number;
  maxAttempts: number;
}
