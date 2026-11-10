import type { CompositionInput } from './schemas';

export interface TimelineItem {
  src: string;
  /** 片段实际时长（秒），以转存后 ffprobe 的结果为准 */
  durationSec: number;
  caption: string;
}

export function secondsToFrames(seconds: number, fps: number): number {
  return Math.max(1, Math.round(seconds * fps));
}

/** 按镜头顺序生成 Remotion 合成输入：片段依次拼接，每个镜头的字幕覆盖该镜头的时间段 */
export function buildCompositionInput(
  items: readonly TimelineItem[],
  opts: { fps: number; width: number; height: number },
): CompositionInput {
  let cursor = 0;
  const clips: CompositionInput['clips'] = [];
  const captions: CompositionInput['captions'] = [];
  for (const item of items) {
    const frames = secondsToFrames(item.durationSec, opts.fps);
    clips.push({ src: item.src, durationInFrames: frames });
    const caption = item.caption.trim();
    if (caption) captions.push({ text: caption, fromFrame: cursor, durationInFrames: frames });
    cursor += frames;
  }
  return { fps: opts.fps, width: opts.width, height: opts.height, clips, captions };
}

export function totalFrames(input: Pick<CompositionInput, 'clips'>): number {
  return input.clips.reduce((sum, c) => sum + c.durationInFrames, 0);
}
