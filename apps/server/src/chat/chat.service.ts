import { Injectable } from '@nestjs/common';
import {
  SHOT_EDITABLE_FIELDS,
  SHOT_FIELD_LABELS,
  STORY_DURATIONS,
  storyboardSpecSchema,
  type Shot,
  type StoryboardSpec,
} from '@ai-creative/shared';
import { z } from 'zod';
import { badRequest, conflict, notFound } from '../common/errors';
import { shortId } from '../common/util';
import { chatSystem } from '../creative/prompts';
import { applyTotalDuration, StoryboardService } from '../creative/storyboard.service';
import { StorylinesService } from '../creative/storylines.service';
import { OutputsService } from '../generation/outputs.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProductsService } from '../products/products.service';
import { ProjectsService } from '../projects/projects.service';
import { LlmService } from '../providers/llm/llm.service';
import { selectedVideoModel } from '../providers/registry';

export const CHAT_PAGES = ['product', 'storylines', 'storyboard', 'work'] as const;
export type ChatPage = (typeof CHAT_PAGES)[number];

const PAGE_NAMES: Record<ChatPage, string> = {
  product: '商品素材',
  storylines: '故事线',
  storyboard: '故事板',
  work: '作品',
};

const str = (max: number) => z.string().trim().max(max);
const shotChanges = z
  .object(Object.fromEntries(SHOT_EDITABLE_FIELDS.map((f) => [f, str(300).optional()])) as Record<(typeof SHOT_EDITABLE_FIELDS)[number], z.ZodOptional<z.ZodString>>)
  .partial();

const productOps = z.discriminatedUnion('op', [
  z.object({ op: z.literal('update_product'), name: str(60).optional(), description: str(500).optional(), targetAudience: str(100).optional() }),
  z.object({ op: z.literal('add_fact'), text: str(80).min(1) }),
  z.object({ op: z.literal('update_fact'), factId: z.string(), text: str(80).min(1) }),
  z.object({ op: z.literal('remove_fact'), factId: z.string() }),
  z.object({ op: z.literal('confirm_fact'), factId: z.string() }),
]);

const storylineOps = z.discriminatedUnion('op', [
  z.object({ op: z.literal('regenerate_storylines'), direction: str(200).min(1) }),
  z.object({
    op: z.literal('update_storyline'),
    storylineId: z.string(),
    title: str(40).optional(),
    style: str(60).optional(),
    hook: str(80).optional(),
    durationSec: z.union([z.literal(15), z.literal(30), z.literal(60)]).optional(),
  }),
]);

const storyboardOps = z.discriminatedUnion('op', [
  z.object({ op: z.literal('update_shot'), shotId: z.string(), changes: shotChanges }),
  z.object({ op: z.literal('set_shot_duration'), shotId: z.string(), durationSec: z.number().int().positive() }),
  z.object({ op: z.literal('add_shot'), afterShotId: z.string().nullable(), shot: shotChanges, durationSec: z.number().int().positive().optional() }),
  z.object({ op: z.literal('remove_shot'), shotId: z.string() }),
  z.object({ op: z.literal('move_shot'), shotId: z.string(), toIndex: z.number().int().min(0) }),
  z.object({ op: z.literal('set_total_duration'), durationSec: z.union([z.literal(15), z.literal(30), z.literal(60)]) }),
  z.object({ op: z.literal('set_shot_refs'), shotId: z.string(), refIds: z.array(z.string()).max(6) }),
  z.object({ op: z.literal('update_reference'), refId: z.string(), name: str(30).optional(), description: str(200).optional() }),
  z.object({ op: z.literal('regenerate_reference'), refId: z.string(), instruction: str(200) }),
  z.object({ op: z.literal('update_profiles'), styleProfile: str(200).optional(), voiceProfile: str(100).optional() }),
  z.object({ op: z.literal('back_to_storylines'), direction: str(200) }),
]);

const workOps = z.discriminatedUnion('op', [
  z.object({ op: z.literal('update_caption'), shotId: z.string(), caption: str(40) }),
  z.object({ op: z.literal('reshoot_shot'), shotId: z.string(), changes: shotChanges.optional() }),
  z.object({ op: z.literal('revert_shot'), shotId: z.string(), clipVersion: z.number().int().positive() }),
]);

const OPS: Record<ChatPage, z.ZodTypeAny> = { product: productOps, storylines: storylineOps, storyboard: storyboardOps, work: workOps };

const fieldList = SHOT_EDITABLE_FIELDS.map((f) => `${f}（${SHOT_FIELD_LABELS[f]}）`).join('、');
const OPS_DOC: Record<ChatPage, string> = {
  product: `- {"op":"update_product","name"?,"description"?,"targetAudience"?}：修改商品名称、描述、目标受众
- {"op":"add_fact","text"}：新增一条卖点（商家亲口说的信息）
- {"op":"update_fact","factId","text"}：改写一条卖点
- {"op":"remove_fact","factId"}：删除一条卖点
- {"op":"confirm_fact","factId"}：确认一条 AI 建议的卖点`,
  storylines: `- {"op":"regenerate_storylines","direction"}：按方向重新生成 4 条故事线，direction 写清人群、类型、时长、卖点、风格等要求
- {"op":"update_storyline","storylineId","title"?,"style"?,"hook"?,"durationSec"?}：修改某一条故事线（durationSec 只能是 15/30/60）`,
  storyboard: `- {"op":"update_shot","shotId","changes":{字段: 新内容}}：修改镜头，可改字段：${fieldList}
- {"op":"set_shot_duration","shotId","durationSec"}：修改单个镜头时长
- {"op":"add_shot","afterShotId"(null 表示放最前),"shot":{字段: 内容},"durationSec"?}：新增镜头
- {"op":"remove_shot","shotId"}：删除镜头
- {"op":"move_shot","shotId","toIndex"(从 0 开始)}：调整镜头顺序
- {"op":"set_total_duration","durationSec"(15/30/60)}：修改总时长，各镜头按比例重新分配
- {"op":"set_shot_refs","shotId","refIds"}：修改镜头使用的参考图
- {"op":"update_reference","refId","name"?,"description"?}：修改参考图的名称、描述
- {"op":"regenerate_reference","refId","instruction"}：按要求重新生成某张参考图（如“把客厅换成浴室”“商品换成白色影棚背景”）
- {"op":"update_profiles","styleProfile"?,"voiceProfile"?}：修改全片风格、口播音色
- {"op":"back_to_storylines","direction"}：对故事线方向不满意，回到故事线按新方向重新生成`,
  work: `- {"op":"update_caption","shotId","caption"}：修改某个镜头的字幕（只重新合成，不重新生成视频）
- {"op":"reshoot_shot","shotId","changes"?:{字段: 新内容}}：重新生成某个镜头，可同时修改镜头内容（可改字段：${fieldList}）；需要商家在确认页确认后才会生成
- {"op":"revert_shot","shotId","clipVersion"}：把某个镜头换回之前生成的某个版本（只重新合成）`,
};

interface Change {
  title: string;
  before?: string;
  after?: string;
}

@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectsService,
    private readonly products: ProductsService,
    private readonly storylines: StorylinesService,
    private readonly storyboards: StoryboardService,
    private readonly outputs: OutputsService,
    private readonly llm: LlmService,
  ) {}

  /** 把一句话转成修改提案（不改数据），商家看过对比后点“应用”才生效（D-24） */
  async propose(userId: string, projectId: string, page: ChatPage, message: string) {
    const project = await this.projects.requireProject(userId, projectId);
    const context = await this.pageContext(project.id, project.productId, page);
    const schema = z.object({
      reply: z.string().default(''),
      operations: z.array(OPS[page]).max(20).default([]),
      clarification: z.string().default(''),
    });
    const result = await this.llm.completeJson(
      {
        purpose: 'chat_edit',
        system: chatSystem(PAGE_NAMES[page], OPS_DOC[page]),
        user: `当前内容（JSON）：\n${JSON.stringify(context.data)}\n\n商家的要求：${message}`,
      },
      schema,
      { validate: (d) => this.checkIds(page, context.data, d.operations as Op[]) },
    );
    const operations = result.operations as Op[];
    const changes = this.describe(page, context.data, operations);
    const edit = await this.prisma.chatEdit.create({
      data: {
        projectId,
        page,
        message,
        reply: result.clarification || result.reply,
        operations: { baseVersion: context.version, items: operations },
        changes: changes as unknown as object,
        status: 'PROPOSED',
      },
    });
    return { id: edit.id, reply: edit.reply, clarification: result.clarification, operations, changes };
  }

  async discard(userId: string, editId: string) {
    const edit = await this.requireEdit(userId, editId);
    await this.prisma.chatEdit.update({ where: { id: edit.id }, data: { status: 'DISCARDED' } });
    return { ok: true };
  }

  private async requireEdit(userId: string, editId: string) {
    const edit = await this.prisma.chatEdit.findFirst({ where: { id: editId, project: { userId } } });
    if (!edit) throw notFound('修改提案');
    return edit;
  }

  /** 应用提案。需要调用视频模型的操作只返回跳转信息，由商家在确认页确认 */
  async apply(userId: string, editId: string) {
    const edit = await this.requireEdit(userId, editId);
    if (edit.status !== 'PROPOSED') throw conflict('EDIT_DONE', '这个提案已经处理过了');
    const page = edit.page as ChatPage;
    const { baseVersion, items } = edit.operations as { baseVersion: number | null; items: Op[] };
    const project = await this.projects.requireProject(userId, edit.projectId);
    const result: { navigate?: { page: string; shotIds?: string[] } } = {};

    if (page === 'product') {
      for (const op of items as ProductOp[]) {
        if (op.op === 'update_product') await this.products.update(userId, project.id, { name: op.name, description: op.description, targetAudience: op.targetAudience });
        if (op.op === 'add_fact') await this.products.addFact(userId, project.id, op.text);
        if (op.op === 'update_fact') await this.products.updateFact(userId, op.factId, { text: op.text });
        if (op.op === 'remove_fact') await this.products.removeFact(userId, op.factId);
        if (op.op === 'confirm_fact') await this.products.updateFact(userId, op.factId, { confirm: true });
      }
    } else if (page === 'storylines') {
      for (const op of items as StorylineOp[]) {
        if (op.op === 'regenerate_storylines') await this.storylines.generate(userId, project.id, op.direction);
        if (op.op === 'update_storyline') {
          const { op: _op, storylineId, ...patch } = op;
          await this.storylines.update(userId, storylineId, Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)));
        }
      }
    } else {
      const latest = await this.storyboards.requireLatest(userId, project.id);
      if (baseVersion !== null && latest.row.version !== baseVersion) {
        throw conflict('STORYBOARD_CHANGED', '故事板在提出修改后又被改过，请重新描述你的修改');
      }
      if (page === 'storyboard') {
        const ops = items as StoryboardOp[];
        const specOps = ops.filter((o) => !['regenerate_reference', 'back_to_storylines'].includes(o.op));
        if (specOps.length) {
          const next = applyStoryboardOps(latest.spec, specOps);
          await this.storyboards.saveVersion(userId, project.id, next, { note: `对话修改：${edit.message.slice(0, 40)}`, expectedVersion: latest.row.version });
        }
        for (const op of ops) {
          if (op.op === 'regenerate_reference') await this.storyboards.regenerateReference(userId, project.id, op.refId, op.instruction);
        }
        const back = ops.find((o) => o.op === 'back_to_storylines');
        if (back && back.op === 'back_to_storylines') {
          await this.storylines.generate(userId, project.id, back.direction);
          result.navigate = { page: 'storylines' };
        }
      } else {
        const ops = items as WorkOp[];
        const shotEdits = ops.filter((o) => o.op === 'update_caption' || (o.op === 'reshoot_shot' && o.changes && Object.keys(o.changes).length));
        if (shotEdits.length) {
          const next = structuredClone(latest.spec);
          for (const op of shotEdits) {
            const shot = next.shots.find((s) => s.shotId === op.shotId)!;
            if (op.op === 'update_caption') shot.caption = op.caption;
            if (op.op === 'reshoot_shot') Object.assign(shot, cleanChanges(op.changes));
          }
          await this.storyboards.saveVersion(userId, project.id, next, { note: `对话修改：${edit.message.slice(0, 40)}`, expectedVersion: latest.row.version });
        }
        const reshoot = ops.filter((o) => o.op === 'reshoot_shot').map((o) => o.shotId);
        const reverts = ops.filter((o): o is Extract<WorkOp, { op: 'revert_shot' }> => o.op === 'revert_shot');
        for (const op of reverts) {
          const clip = await this.prisma.clip.findFirst({ where: { projectId: project.id, shotId: op.shotId, version: op.clipVersion } });
          if (!clip) throw notFound(`版本 ${op.clipVersion}`);
          await this.outputs.selectClip(userId, project.id, op.shotId, clip.id);
        }
        const captionOnly = ops.some((o) => o.op === 'update_caption') && reverts.length === 0;
        if (captionOnly && project.currentOutputId) await this.outputs.recomposeCurrent(userId, project.id, '修改字幕');
        if (reshoot.length) result.navigate = { page: 'confirm', shotIds: [...new Set(reshoot)] };
      }
    }
    await this.prisma.chatEdit.update({
      where: { id: edit.id },
      data: { status: 'APPLIED', appliedAt: new Date(), result: result as object },
    });
    return { ok: true, ...result };
  }

  private async pageContext(projectId: string, productId: string, page: ChatPage): Promise<{ version: number | null; data: unknown }> {
    if (page === 'product') {
      const product = await this.prisma.product.findUniqueOrThrow({ where: { id: productId }, include: { facts: true } });
      return {
        version: null,
        data: {
          product: { name: product.name, description: product.description, targetAudience: product.targetAudience },
          facts: product.facts.map((f) => ({ factId: f.id, text: f.text, confirmed: f.source === 'MERCHANT_CONFIRMED' })),
        },
      };
    }
    if (page === 'storylines') {
      const rows = await this.projects.latestStorylines(projectId);
      return { version: null, data: { storylines: rows.map((r) => ({ storylineId: r.id, ...r.content })) } };
    }
    const latest = await this.storyboards.latest(projectId);
    if (!latest) throw badRequest('NO_STORYBOARD', '还没有故事板');
    const data: Record<string, unknown> = {
      totalDurationSec: latest.spec.durationSec,
      shotDurationRule: selectedVideoModel().duration,
      styleProfile: latest.spec.styleProfile,
      voiceProfile: latest.spec.voiceProfile,
      references: latest.spec.references.map((r) => ({ refId: r.refId, kind: r.kind, name: r.name, description: r.description })),
      shots: latest.spec.shots.map((s, i) => ({ index: i, ...s })),
    };
    if (page === 'work') {
      const clips = await this.prisma.clip.findMany({ where: { projectId, status: 'SUCCEEDED' }, select: { shotId: true, version: true } });
      data.generatedVersions = clips;
    }
    return { version: latest.row.version, data };
  }

  private checkIds(page: ChatPage, data: unknown, ops: Op[]): string | null {
    const d = data as {
      facts?: Array<{ factId: string }>;
      storylines?: Array<{ storylineId: string }>;
      shots?: Array<{ shotId: string }>;
      references?: Array<{ refId: string }>;
      generatedVersions?: Array<{ shotId: string; version: number }>;
    };
    const facts = new Set(d.facts?.map((f) => f.factId));
    const storylines = new Set(d.storylines?.map((s) => s.storylineId));
    const shots = new Set(d.shots?.map((s) => s.shotId));
    const refs = new Set(d.references?.map((r) => r.refId));
    for (const op of ops as Array<Record<string, unknown>>) {
      if ('factId' in op && !facts.has(op.factId as string)) return `factId ${String(op.factId)} 不存在`;
      if ('storylineId' in op && !storylines.has(op.storylineId as string)) return `storylineId ${String(op.storylineId)} 不存在`;
      if ('shotId' in op && !shots.has(op.shotId as string)) return `shotId ${String(op.shotId)} 不存在`;
      if ('afterShotId' in op && op.afterShotId !== null && !shots.has(op.afterShotId as string)) return `afterShotId 不存在`;
      if ('refId' in op && !refs.has(op.refId as string)) return `refId ${String(op.refId)} 不存在`;
      if (Array.isArray(op.refIds) && (op.refIds as string[]).some((r) => !refs.has(r))) return 'refIds 里有不存在的参考图';
      if (page === 'work' && op.op === 'revert_shot') {
        const ok = d.generatedVersions?.some((v) => v.shotId === op.shotId && v.version === op.clipVersion);
        if (!ok) return `镜头 ${String(op.shotId)} 没有版本 ${String(op.clipVersion)}`;
      }
      if (op.op === 'set_total_duration' && !STORY_DURATIONS.includes(op.durationSec as 15)) return '总时长只能是 15/30/60';
    }
    return null;
  }

  private describe(page: ChatPage, data: unknown, ops: Op[]): Change[] {
    const d = data as {
      product?: Record<string, string>;
      facts?: Array<{ factId: string; text: string }>;
      storylines?: Array<{ storylineId: string; title: string; style: string; hook: string; durationSec: number }>;
      shots?: Array<Shot & { index: number }>;
      references?: Array<{ refId: string; name: string; description: string }>;
      totalDurationSec?: number;
      styleProfile?: string;
      voiceProfile?: string;
    };
    const shotNo = (id: string) => `镜头 ${(d.shots?.find((s) => s.shotId === id)?.index ?? 0) + 1}`;
    const shotOf = (id: string) => d.shots?.find((s) => s.shotId === id);
    const changes: Change[] = [];
    for (const op of ops as Array<Op>) {
      switch (op.op) {
        case 'update_product':
          for (const k of ['name', 'description', 'targetAudience'] as const) {
            if (op[k] !== undefined) changes.push({ title: { name: '商品名称', description: '商品描述', targetAudience: '目标受众' }[k], before: d.product?.[k], after: op[k] });
          }
          break;
        case 'add_fact':
          changes.push({ title: '新增卖点', after: op.text });
          break;
        case 'update_fact':
          changes.push({ title: '修改卖点', before: d.facts?.find((f) => f.factId === op.factId)?.text, after: op.text });
          break;
        case 'remove_fact':
          changes.push({ title: '删除卖点', before: d.facts?.find((f) => f.factId === op.factId)?.text });
          break;
        case 'confirm_fact':
          changes.push({ title: '确认卖点', after: d.facts?.find((f) => f.factId === op.factId)?.text });
          break;
        case 'regenerate_storylines':
          changes.push({ title: '按新方向重新生成 4 条故事线', after: op.direction });
          break;
        case 'update_storyline': {
          const s = d.storylines?.find((x) => x.storylineId === op.storylineId);
          if (op.title !== undefined) changes.push({ title: '故事线标题', before: s?.title, after: op.title });
          if (op.style !== undefined) changes.push({ title: `「${s?.title}」风格`, before: s?.style, after: op.style });
          if (op.hook !== undefined) changes.push({ title: `「${s?.title}」开场钩子`, before: s?.hook, after: op.hook });
          if (op.durationSec !== undefined) changes.push({ title: `「${s?.title}」时长`, before: `${s?.durationSec} 秒`, after: `${op.durationSec} 秒` });
          break;
        }
        case 'update_shot':
          for (const [k, v] of Object.entries(op.changes)) {
            if (v === undefined) continue;
            changes.push({ title: `${shotNo(op.shotId)} · ${SHOT_FIELD_LABELS[k as keyof typeof SHOT_FIELD_LABELS]}`, before: String(shotOf(op.shotId)?.[k as keyof Shot] ?? ''), after: v });
          }
          break;
        case 'set_shot_duration':
          changes.push({ title: `${shotNo(op.shotId)} · 时长`, before: `${shotOf(op.shotId)?.durationSec} 秒`, after: `${op.durationSec} 秒` });
          break;
        case 'add_shot':
          changes.push({ title: `新增镜头（${op.afterShotId ? `${shotNo(op.afterShotId)} 之后` : '放在最前'}）`, after: op.shot.action || op.shot.subject || op.shot.narration || '' });
          break;
        case 'remove_shot':
          changes.push({ title: `删除${shotNo(op.shotId)}`, before: shotOf(op.shotId)?.action });
          break;
        case 'move_shot':
          changes.push({ title: `${shotNo(op.shotId)} 移到第 ${op.toIndex + 1} 位` });
          break;
        case 'set_total_duration':
          changes.push({ title: '总时长', before: `${d.totalDurationSec} 秒`, after: `${op.durationSec} 秒（各镜头按比例重新分配）` });
          break;
        case 'set_shot_refs':
          changes.push({ title: `${shotNo(op.shotId)} · 参考图`, after: op.refIds.map((r) => d.references?.find((x) => x.refId === r)?.name ?? r).join('、') });
          break;
        case 'update_reference': {
          const r = d.references?.find((x) => x.refId === op.refId);
          if (op.name !== undefined) changes.push({ title: '参考图名称', before: r?.name, after: op.name });
          if (op.description !== undefined) changes.push({ title: `「${r?.name}」描述`, before: r?.description, after: op.description });
          break;
        }
        case 'regenerate_reference':
          changes.push({ title: `重新生成参考图「${d.references?.find((x) => x.refId === op.refId)?.name}」`, after: op.instruction || '按原描述重新生成' });
          break;
        case 'update_profiles':
          if (op.styleProfile !== undefined) changes.push({ title: '全片风格', before: d.styleProfile, after: op.styleProfile });
          if (op.voiceProfile !== undefined) changes.push({ title: '口播音色', before: d.voiceProfile, after: op.voiceProfile });
          break;
        case 'back_to_storylines':
          changes.push({ title: '回到故事线，按新方向重新生成', after: op.direction });
          break;
        case 'update_caption':
          changes.push({ title: `${shotNo(op.shotId)} · 字幕（只重新合成）`, before: shotOf(op.shotId)?.caption, after: op.caption });
          break;
        case 'reshoot_shot':
          changes.push({ title: `重新生成${shotNo(op.shotId)}（需在确认页确认）` });
          for (const [k, v] of Object.entries(op.changes ?? {})) {
            if (v === undefined) continue;
            changes.push({ title: `${shotNo(op.shotId)} · ${SHOT_FIELD_LABELS[k as keyof typeof SHOT_FIELD_LABELS]}`, before: String(shotOf(op.shotId)?.[k as keyof Shot] ?? ''), after: v });
          }
          break;
        case 'revert_shot':
          changes.push({ title: `${shotNo(op.shotId)} 换回版本 ${op.clipVersion}（只重新合成）` });
          break;
      }
    }
    return changes;
  }
}

type ProductOp = z.infer<typeof productOps>;
type StorylineOp = z.infer<typeof storylineOps>;
type StoryboardOp = z.infer<typeof storyboardOps>;
type WorkOp = z.infer<typeof workOps>;
type Op = ProductOp | StorylineOp | StoryboardOp | WorkOp;

function cleanChanges(changes: Record<string, string | undefined> | undefined): Partial<Shot> {
  return Object.fromEntries(Object.entries(changes ?? {}).filter(([k, v]) => v !== undefined && (SHOT_EDITABLE_FIELDS as readonly string[]).includes(k)));
}

/** 在故事板副本上依次执行修改操作（纯函数，便于测试） */
export function applyStoryboardOps(spec: StoryboardSpec, ops: StoryboardOp[]): StoryboardSpec {
  let next = structuredClone(spec);
  const cap = selectedVideoModel();
  for (const op of ops) {
    const idx = (id: string) => next.shots.findIndex((s) => s.shotId === id);
    switch (op.op) {
      case 'update_shot':
        Object.assign(next.shots[idx(op.shotId)]!, cleanChanges(op.changes));
        break;
      case 'set_shot_duration':
        next.shots[idx(op.shotId)]!.durationSec = op.durationSec;
        break;
      case 'add_shot': {
        const shot: Shot = {
          shotId: shortId('shot'),
          purpose: '',
          durationSec: op.durationSec ?? cap.duration.recommended,
          subject: '',
          videoType: '',
          camera: '',
          action: '',
          scene: '',
          narration: '',
          caption: '',
          consistency: '',
          refIds: [],
          ...cleanChanges(op.shot),
        };
        const at = op.afterShotId === null ? 0 : idx(op.afterShotId) + 1;
        next.shots.splice(at, 0, shot);
        break;
      }
      case 'remove_shot':
        if (next.shots.length <= 1) throw badRequest('LAST_SHOT', '至少保留一个镜头');
        next.shots.splice(idx(op.shotId), 1);
        break;
      case 'move_shot': {
        const [shot] = next.shots.splice(idx(op.shotId), 1);
        next.shots.splice(Math.min(op.toIndex, next.shots.length), 0, shot!);
        break;
      }
      case 'set_total_duration':
        next = applyTotalDuration(next, op.durationSec);
        break;
      case 'set_shot_refs':
        next.shots[idx(op.shotId)]!.refIds = op.refIds;
        break;
      case 'update_reference': {
        const ref = next.references.find((r) => r.refId === op.refId)!;
        if (op.name !== undefined) ref.name = op.name;
        if (op.description !== undefined) ref.description = op.description;
        break;
      }
      case 'update_profiles':
        if (op.styleProfile !== undefined) next.styleProfile = op.styleProfile;
        if (op.voiceProfile !== undefined) next.voiceProfile = op.voiceProfile;
        break;
      default:
        break;
    }
  }
  next.durationSec = next.shots.reduce((sum, s) => sum + s.durationSec, 0);
  return storyboardSpecSchema.parse(next);
}
