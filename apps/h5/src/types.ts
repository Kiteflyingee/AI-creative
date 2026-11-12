import type { Reference, Resolution, Shot, StoryboardSpec, StorylineContent } from '@ai-creative/shared';

export type AssetKind = 'PRODUCT' | 'CHARACTER' | 'SCENE';

export interface AssetView {
  id: string;
  kind: AssetKind;
  origin: 'UPLOAD' | 'AI_GENERATED';
  status: 'GENERATING' | 'READY' | 'FAILED' | 'REJECTED';
  label: string;
  viewRole: string;
  description: string;
  quality: { level: string; issues: string[] } | null;
  face: 'UNKNOWN' | 'NONE' | 'DETECTED';
  faceResolution: 'NONE' | 'VIRTUAL_PORTRAIT' | 'AI_SIMILAR' | 'EXCLUDED';
  virtualPortraitId: string | null;
  replacementAssetId: string | null;
  sourceAssetId: string | null;
  comparison: { consistent: 'pass' | 'review' | 'fail'; issues: string[] } | null;
  errorMessage: string | null;
  url: string | null;
}

export interface FactView {
  id: string;
  text: string;
  /** MERCHANT_CONFIRMED = 选中（会进入口播和字幕）；AI_SUGGESTED = 未选中 */
  source: 'MERCHANT_CONFIRMED' | 'AI_SUGGESTED';
  /** 谁写的：AI 提炼，或商家自己写（含改过的 AI 建议） */
  origin: 'AI' | 'MERCHANT';
  /** AI 的依据：“商家描述”或“图片可见” */
  basis: string;
}

export interface ClipView {
  id: string;
  shotId: string;
  version: number;
  jobId: string;
  status: 'QUEUED' | 'SUBMITTING' | 'SUBMITTED' | 'RUNNING' | 'TRANSFERRING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
  specHash: string;
  durationSec: number;
  actualDurationSec: number | null;
  errorMessage: string | null;
  url: string | null;
}

export interface OutputView {
  id: string;
  version: number;
  status: 'COMPOSING' | 'READY' | 'FAILED';
  jobId: string | null;
  selection: Array<{ shotId: string; clipId: string }>;
  captions: Array<{ shotId: string; text: string }>;
  note: string;
  resolution: Resolution;
  durationSec: number | null;
  width: number | null;
  height: number | null;
  errorMessage: string | null;
  shareToken: string | null;
  url: string | null;
  coverUrl: string | null;
  createdAt: string;
}

export type JobStatus = 'QUEUED' | 'GENERATING' | 'COMPOSING' | 'QC' | 'COMPLETED' | 'PARTIAL_FAILED' | 'FAILED' | 'CANCELLED';

export interface JobSummary {
  id: string;
  kind: 'FULL' | 'RESHOOT';
  status: JobStatus;
  resolution: Resolution;
  shotIds: string[];
  outputId: string | null;
  errorMessage: string | null;
  createdAt: string;
}

export interface ProjectView {
  project: { id: string; title: string; currentOutputId: string | null };
  product: {
    id: string;
    name: string;
    description: string;
    targetAudience: string;
    category: string;
    /** productName：商家没填名称时 AI 起的名称（商家已填时为空） */
    analysis: { productName?: string; missingInfo: string[]; suggestions: string[] } | null;
    analyzedAt: string | null;
    facts: FactView[];
  };
  assets: AssetView[];
  storylines: Array<{ id: string; batch: number; selected: boolean; direction: string; content: StorylineContent }>;
  storyboard: { id: string; version: number; storylineId: string; spec: StoryboardSpec } | null;
  jobs: JobSummary[];
  clips: ClipView[];
  outputs: OutputView[];
  model: { duration: { min: number; max: number; allowed?: number[]; recommended: number }; resolutions: Resolution[] };
  virtualPortraits: Array<{ id: string; name: string; description: string; previewUrl: string }>;
}

export interface JobView extends JobSummary {
  projectId: string;
  queuedAhead: number;
  clips: Array<{ id: string; shotId: string; version: number; status: ClipView['status']; errorMessage: string | null }>;
}

export interface ChatProposal {
  id: string;
  reply: string;
  clarification: string;
  changes: Array<{ title: string; before?: string; after?: string }>;
}

export type { Reference, Shot, StoryboardSpec, StorylineContent };
