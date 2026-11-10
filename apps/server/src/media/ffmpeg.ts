import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** 所有媒体命令都用参数数组调用，不经过 shell */
async function ffmpeg(args: string[], timeoutMs = 10 * 60_000) {
  try {
    await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], {
      timeout: timeoutMs,
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr ?? '';
    throw new Error(`ffmpeg 失败：${stderr.slice(-800) || (err as Error).message}`);
  }
}

export interface ProbeResult {
  durationSec: number;
  width: number;
  height: number;
  hasAudio: boolean;
  tags: Record<string, string>;
}

export async function probe(file: string): Promise<ProbeResult> {
  const { stdout } = await run(
    'ffprobe',
    ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file],
    { timeout: 60_000, maxBuffer: 16 * 1024 * 1024 },
  );
  const info = JSON.parse(stdout) as {
    format?: { duration?: string; tags?: Record<string, string> };
    streams?: Array<{ codec_type?: string; width?: number; height?: number; duration?: string }>;
  };
  const video = info.streams?.find((s) => s.codec_type === 'video');
  if (!video) throw new Error('文件中没有视频流');
  const duration = Number(info.format?.duration ?? video.duration ?? 0);
  const tags: Record<string, string> = {};
  for (const [k, v] of Object.entries(info.format?.tags ?? {})) tags[k.toLowerCase()] = v;
  return {
    durationSec: Number.isFinite(duration) ? duration : 0,
    width: video.width ?? 0,
    height: video.height ?? 0,
    hasAudio: Boolean(info.streams?.some((s) => s.codec_type === 'audio')),
    tags,
  };
}

/**
 * 片段规范化：统一为目标尺寸（铺满裁切）、24fps、H.264 + AAC 48kHz 立体声、响度 -16 LUFS。
 * 没有音轨的片段补一条静音轨，保证拼接时音视频对齐。
 */
export async function normalizeClip(
  input: string,
  output: string,
  opts: { width: number; height: number; fps: number },
) {
  const info = await probe(input);
  const vf = `scale=${opts.width}:${opts.height}:force_original_aspect_ratio=increase,crop=${opts.width}:${opts.height},setsar=1,fps=${opts.fps},format=yuv420p`;
  const args = ['-i', input];
  if (!info.hasAudio) args.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000');
  args.push('-map', '0:v:0', '-map', info.hasAudio ? '0:a:0' : '1:a:0');
  args.push('-vf', vf, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '19');
  if (info.hasAudio) args.push('-af', 'loudnorm=I=-16:TP=-1.5:LRA=11');
  args.push('-ar', '48000', '-ac', '2', '-c:a', 'aac', '-b:a', '160k', '-shortest', '-movflags', '+faststart', output);
  await ffmpeg(args);
}

/** 写入 AI 生成标识（元数据，不改画面，流复制） */
export async function writeAiMetadata(input: string, output: string, tags: Record<string, string>) {
  const args = ['-i', input, '-map', '0', '-c', 'copy'];
  for (const [k, v] of Object.entries(tags)) args.push('-metadata', `${k}=${v}`);
  args.push('-movflags', '+faststart+use_metadata_tags', output);
  await ffmpeg(args);
}

export async function extractFrame(input: string, atSec: number, output: string, maxWidth?: number) {
  const args = ['-ss', Math.max(0, atSec).toFixed(3), '-i', input, '-frames:v', '1'];
  if (maxWidth) args.push('-vf', `scale='min(${maxWidth},iw)':-2`);
  args.push('-q:v', '3', output);
  await ffmpeg(args, 60_000);
}

/** 生成测试/示例视频：纯色画面 + 正弦波音频 */
export async function generateTestVideo(
  output: string,
  opts: { width: number; height: number; durationSec: number; color: string; fps?: number },
) {
  const fps = opts.fps ?? 24;
  await ffmpeg([
    '-f', 'lavfi', '-i', `color=c=${opts.color}:s=${opts.width}x${opts.height}:d=${opts.durationSec}:r=${fps}`,
    '-f', 'lavfi', '-i', `sine=frequency=440:sample_rate=48000:duration=${opts.durationSec}`,
    '-shortest', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', output,
  ]);
}

/** 按顺序拼接已规范化的片段（只用于测试中替代 Remotion） */
export async function concatClips(inputs: string[], output: string) {
  const args: string[] = [];
  for (const file of inputs) args.push('-i', file);
  const streams = inputs.map((_, i) => `[${i}:v:0][${i}:a:0]`).join('');
  args.push(
    '-filter_complex', `${streams}concat=n=${inputs.length}:v=1:a=1[v][a]`,
    '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', output,
  );
  await ffmpeg(args);
}
