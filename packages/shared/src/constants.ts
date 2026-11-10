export const RESOLUTIONS = ['480p', '720p', '1080p'] as const;
export type Resolution = (typeof RESOLUTIONS)[number];
export const DEFAULT_RESOLUTION: Resolution = '720p';

/** 第一版画面固定为竖屏 */
export const ASPECT_RATIO = '9:16' as const;
export const OUTPUT_FPS = 24;

export const STORY_DURATIONS = [15, 30, 60] as const;
export type StoryDuration = (typeof STORY_DURATIONS)[number];

/** 故事线类型（与 Kickart 的好物分享、剧情带货等类型对应） */
export const STORY_TYPES = {
  product_share: '好物分享',
  drama: '剧情带货',
  host_talk: '主播口播',
  brand_film: '品牌质感',
} as const;
export type StoryType = keyof typeof STORY_TYPES;
export const STORY_TYPE_KEYS = Object.keys(STORY_TYPES) as [StoryType, ...StoryType[]];

export const REFERENCE_KINDS = ['product', 'character', 'scene'] as const;
export type ReferenceKind = (typeof REFERENCE_KINDS)[number];
export const REFERENCE_KIND_LABELS: Record<ReferenceKind, string> = {
  product: '商品',
  character: '人物',
  scene: '场景',
};

/** 9:16 输出尺寸（宽 x 高，均为偶数） */
export function frameSize(resolution: Resolution): { width: number; height: number } {
  switch (resolution) {
    case '480p':
      return { width: 480, height: 854 };
    case '720p':
      return { width: 720, height: 1280 };
    case '1080p':
      return { width: 1080, height: 1920 };
  }
}

/** 口播建议上限（Kickart 自由创作指引：15 字以内最稳定，最长不超过 30 字） */
export const NARRATION_SOFT_LIMIT = 15;
export const NARRATION_HARD_LIMIT = 30;
export const CAPTION_MAX = 40;
