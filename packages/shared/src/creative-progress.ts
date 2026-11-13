import { z } from 'zod';

/** 只传递服务端真实阶段，不传模型思维链、提示词或未校验的输出。 */
export const creativeProgressSchema = z.object({
  phase: z.enum(['preparing', 'generating', 'validating', 'correcting', 'waiting', 'saving']),
  attempt: z.number().int().positive().optional(),
  retryAfterMs: z.number().nonnegative().optional(),
});
export type CreativeProgress = z.infer<typeof creativeProgressSchema>;
export type ReportCreativeProgress = (progress: CreativeProgress) => void;

export const creativeStreamEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('progress'), progress: creativeProgressSchema }),
  z.object({ type: z.literal('done') }),
  z.object({ type: z.literal('error'), status: z.number().int(), code: z.string(), message: z.string() }),
]);
export type CreativeStreamEvent = z.infer<typeof creativeStreamEventSchema>;
