import { describe, expect, it } from 'vitest';
import { buildCompositionInput, totalFrames } from '../src/timeline';
import { storyboardSpecSchema } from '../src/schemas';

describe('buildCompositionInput', () => {
  it('places captions on each clip time range', () => {
    const input = buildCompositionInput(
      [
        { src: 'a.mp4', durationSec: 5, caption: '开场' },
        { src: 'b.mp4', durationSec: 4.96, caption: '' },
        { src: 'c.mp4', durationSec: 6, caption: '  结尾  ' },
      ],
      { fps: 24, width: 720, height: 1280 },
    );
    expect(input.clips.map((c) => c.durationInFrames)).toEqual([120, 119, 144]);
    expect(totalFrames(input)).toBe(383);
    expect(input.captions).toEqual([
      { text: '开场', fromFrame: 0, durationInFrames: 120 },
      { text: '结尾', fromFrame: 239, durationInFrames: 144 },
    ]);
  });
});

describe('storyboardSpecSchema', () => {
  it('normalizes whitespace in text fields', () => {
    const spec = storyboardSpecSchema.parse({
      schemaVersion: 1,
      durationSec: 5,
      references: [],
      shots: [{ shotId: 's1', durationSec: 5, narration: '你好\n  世界', caption: ' 字幕 ' }],
    });
    expect(spec.shots[0]!.narration).toBe('你好 世界');
    expect(spec.shots[0]!.caption).toBe('字幕');
    expect(spec.shots[0]!.refIds).toEqual([]);
  });
});
