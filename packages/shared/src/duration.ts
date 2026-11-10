/**
 * 镜头时长规则，来自视频模型能力登记表。
 * - 连续范围：min..max 的整数秒（如 Seedance 2.5：4–30）
 * - 离散取值：allowed（如某些模型只支持 4/6/8 秒）
 */
export interface DurationRule {
  min: number;
  max: number;
  allowed?: readonly number[];
  /** 建议的单镜头时长，用于推荐镜头数 */
  recommended: number;
}

export type AllocationResult =
  | { ok: true; durations: number[] }
  | { ok: false; reason: 'no_shots' | 'too_many_shots' | 'too_few_shots' | 'unreachable'; message: string };

export function allowedValues(rule: DurationRule): number[] {
  if (rule.allowed && rule.allowed.length > 0) {
    return [...new Set(rule.allowed)].filter((v) => Number.isInteger(v) && v > 0).sort((a, b) => a - b);
  }
  const values: number[] = [];
  for (let v = Math.ceil(rule.min); v <= Math.floor(rule.max); v++) values.push(v);
  return values;
}

/** 给定总时长，这个规则下可行的镜头数范围 */
export function shotCountRange(total: number, rule: DurationRule): { min: number; max: number } {
  const values = allowedValues(rule);
  if (values.length === 0) return { min: 0, max: -1 };
  const lo = values[0]!;
  const hi = values[values.length - 1]!;
  return { min: Math.ceil(total / hi), max: Math.floor(total / lo) };
}

/** 推荐镜头数：按建议单镜头时长，落在可行范围内 */
export function recommendedShotCount(total: number, rule: DurationRule, cap = 12): number {
  const range = shotCountRange(total, rule);
  const target = Math.round(total / rule.recommended);
  return Math.max(range.min, Math.min(range.max, cap, Math.max(1, target)));
}

/**
 * 把总时长按权重分配给各镜头，每个镜头的时长都必须是规则允许的整数秒，总和严格等于 total。
 * 用动态规划求“与按比例分配的理想值偏差平方和最小”的方案；偏差相同时靠后的镜头取较长值，结果确定。
 */
export function allocateDurations(weights: readonly number[], total: number, rule: DurationRule): AllocationResult {
  const n = weights.length;
  if (n === 0) return { ok: false, reason: 'no_shots', message: '至少需要 1 个镜头' };
  if (!Number.isInteger(total) || total <= 0) {
    return { ok: false, reason: 'unreachable', message: '总时长必须是正整数秒' };
  }
  const values = allowedValues(rule);
  if (values.length === 0) return { ok: false, reason: 'unreachable', message: '模型没有可用的镜头时长' };
  const range = shotCountRange(total, rule);
  if (n > range.max) {
    return {
      ok: false,
      reason: 'too_many_shots',
      message: `${total} 秒最多放 ${range.max} 个镜头（每个镜头至少 ${values[0]} 秒），请删减或合并镜头`,
    };
  }
  if (n < range.min) {
    return {
      ok: false,
      reason: 'too_few_shots',
      message: `${total} 秒至少需要 ${range.min} 个镜头（每个镜头最多 ${values[values.length - 1]} 秒），请增加镜头`,
    };
  }

  const safeWeights = weights.map((w) => (Number.isFinite(w) && w > 0 ? w : 1));
  const sumW = safeWeights.reduce((a, b) => a + b, 0);
  const ideal = safeWeights.map((w) => (w * total) / sumW);

  // best[i][s]：前 i 个镜头总和为 s 时的最小代价
  const INF = Number.POSITIVE_INFINITY;
  const best: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(total + 1).fill(INF));
  const choice: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(total + 1).fill(-1));
  best[0]![0] = 0;
  for (let i = 1; i <= n; i++) {
    const target = ideal[i - 1]!;
    for (let s = 0; s <= total; s++) {
      // 从大到小尝试，偏差相同时保留较长的取值
      for (let k = values.length - 1; k >= 0; k--) {
        const v = values[k]!;
        if (v > s) continue;
        const prev = best[i - 1]![s - v]!;
        if (prev === INF) continue;
        const cost = prev + (v - target) ** 2;
        if (cost < best[i]![s]! - 1e-9) {
          best[i]![s] = cost;
          choice[i]![s] = v;
        }
      }
    }
  }
  if (best[n]![total] === INF) {
    return { ok: false, reason: 'unreachable', message: `当前镜头数无法凑成 ${total} 秒，请调整镜头数` };
  }
  const durations = new Array<number>(n);
  let s = total;
  for (let i = n; i >= 1; i--) {
    const v = choice[i]![s]!;
    durations[i - 1] = v;
    s -= v;
  }
  return { ok: true, durations };
}

export function isDurationAllowed(value: number, rule: DurationRule): boolean {
  return allowedValues(rule).includes(value);
}
