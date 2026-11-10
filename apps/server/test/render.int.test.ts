/**
 * Remotion 真实渲染测试（较慢，单独运行：npm run test:render）。
 * 首次运行时 Remotion 会下载 Chrome Headless Shell。
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { buildCompositionInput } from '@ai-creative/shared';
import { RemotionComposer } from '../src/compose/remotion.composer';
import { extractFrame, generateTestVideo, normalizeClip, probe } from '../src/media/ffmpeg';
import { StorageService } from '../src/storage/storage.service';

jest.setTimeout(10 * 60_000);

describe('Remotion 合成', () => {
  it('按顺序拼接片段，总时长等于各片段之和，字幕出现在对应镜头的时间段', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'render-'));
    const storage = new StorageService();
    try {
      const srcs: string[] = [];
      for (const [i, color] of ['red', 'blue'].entries()) {
        const raw = join(dir, `raw${i}.mp4`);
        const norm = join(dir, `clip${i}.mp4`);
        await generateTestVideo(raw, { width: 480, height: 854, durationSec: 2, color });
        await normalizeClip(raw, norm, { width: 480, height: 854, fps: 24 });
        const key = `render-test/clip${i}.mp4`;
        await storage.putFile(key, norm, 'video/mp4');
        srcs.push(await storage.internalUrl(key));
      }
      const input = buildCompositionInput(
        [
          { src: srcs[0]!, durationSec: 2, caption: '第一个镜头的字幕' },
          { src: srcs[1]!, durationSec: 2, caption: '' },
        ],
        { fps: 24, width: 480, height: 854 },
      );
      const out = join(dir, 'out.mp4');
      await new RemotionComposer().render(input, out);
      const info = await probe(out);
      expect(info.width).toBe(480);
      expect(info.height).toBe(854);
      expect(info.hasAudio).toBe(true);
      expect(Math.abs(info.durationSec - 4)).toBeLessThan(0.2);

      // 字幕区域（画面下方）：第 1 个镜头有字幕，第 2 个镜头没有
      const captionBox = { left: 40, top: 600, width: 400, height: 110 };
      const stdev = async (at: number) => {
        const frame = join(dir, `f${at}.png`);
        await extractFrame(out, at, frame);
        const stats = await sharp(await readFile(frame)).extract(captionBox).stats();
        return stats.channels.reduce((s, c) => s + c.stdev, 0);
      };
      expect(await stdev(1)).toBeGreaterThan(20);
      expect(await stdev(3)).toBeLessThan(5);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
