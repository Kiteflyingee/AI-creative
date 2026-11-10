import { describe, expect, it } from 'vitest';
import { allocateDurations, recommendedShotCount, shotCountRange, type DurationRule } from '../src/duration';

const seedance: DurationRule = { min: 4, max: 30, recommended: 5 };
const discrete: DurationRule = { min: 4, max: 8, allowed: [4, 6, 8], recommended: 6 };

function ok(result: ReturnType<typeof allocateDurations>): number[] {
  if (!result.ok) throw new Error(result.message);
  return result.durations;
}

describe('allocateDurations', () => {
  it.each([15, 30, 60])('equal weights sum to %i and respect the range', (total) => {
    const n = recommendedShotCount(total, seedance);
    const durations = ok(allocateDurations(new Array(n).fill(1), total, seedance));
    expect(durations.reduce((a, b) => a + b, 0)).toBe(total);
    for (const d of durations) {
      expect(Number.isInteger(d)).toBe(true);
      expect(d).toBeGreaterThanOrEqual(4);
      expect(d).toBeLessThanOrEqual(30);
    }
  });

  it('follows weights proportionally', () => {
    // 理想值 [3,5,7]，第一个镜头被抬到最低 4 秒；[4,5,6] 与 [4,4,7] 偏差相同，靠后镜头取较长值
    expect(ok(allocateDurations([3, 5, 7], 15, seedance))).toEqual([4, 4, 7]);
    expect(ok(allocateDurations([1, 1, 2], 20, seedance))).toEqual([5, 5, 10]);
  });

  it('is deterministic', () => {
    const a = allocateDurations([2, 3, 2, 5, 1], 30, seedance);
    const b = allocateDurations([2, 3, 2, 5, 1], 30, seedance);
    expect(a).toEqual(b);
  });

  it('rejects too many shots for the total', () => {
    const result = allocateDurations(new Array(5).fill(1), 15, seedance);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('too_many_shots');
  });

  it('rejects too few shots for the total', () => {
    const result = allocateDurations([1], 60, seedance);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('too_few_shots');
  });

  it('changes with the capability rule (discrete durations)', () => {
    const durations = ok(allocateDurations([1, 1, 1], 18, discrete));
    expect(durations).toEqual([6, 6, 6]);
    const odd = allocateDurations([1, 1], 15, discrete);
    expect(odd.ok).toBe(false);
    if (!odd.ok) expect(odd.reason).toBe('unreachable');
  });

  it('computes the feasible shot count range', () => {
    expect(shotCountRange(15, seedance)).toEqual({ min: 1, max: 3 });
    expect(shotCountRange(60, seedance)).toEqual({ min: 2, max: 15 });
    expect(shotCountRange(30, discrete)).toEqual({ min: 4, max: 7 });
  });
});
