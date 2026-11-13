import { Injectable } from '@nestjs/common';
import { storyDurationSchema, storylineContentSchema, STORY_TYPES, type StoryDuration, type StorylineContent, type ReportCreativeProgress } from '@ai-creative/shared';
import { badRequest, notFound } from '../common/errors';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectsService } from '../projects/projects.service';
import { LlmService } from '../providers/llm/llm.service';
import { CREATIVE_PATTERNS } from './patterns';
import { storylinesOutputSchema, storylinesSystem } from './prompts';

/** 检查故事线时间段：从 0 开始首尾相接，最后一段结束于总时长 */
export function checkSegments(c: StorylineContent): string | null {
  const segs = [...c.segments].sort((a, b) => a.startSec - b.startSec);
  if (segs[0]!.startSec !== 0) return `「${c.title}」的第一段必须从 0 秒开始`;
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i]!;
    if (seg.endSec <= seg.startSec) return `「${c.title}」第 ${i + 1} 段的结束时间必须大于开始时间`;
    if (i > 0 && seg.startSec !== segs[i - 1]!.endSec) return `「${c.title}」的时间段必须首尾相接`;
  }
  if (segs[segs.length - 1]!.endSec !== c.durationSec) return `「${c.title}」最后一段必须在 ${c.durationSec} 秒结束`;
  return null;
}

@Injectable()
export class StorylinesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectsService,
    private readonly llm: LlmService,
  ) {}

  /** 生成 4 条故事线（Kickart：每条含标题、风格、时长和按时间段的内容）；“换一换”即再生成一批 */
  async generate(userId: string, projectId: string, direction = '', duration?: StoryDuration, onProgress?: ReportCreativeProgress) {
    const project = await this.projects.requireProject(userId, projectId);
    const durationSec = storyDurationSchema.parse(duration ?? project.targetDurationSec);
    const product = await this.prisma.product.findUniqueOrThrow({
      where: { id: project.productId },
      include: { facts: { orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] } },
    });
    if (!product.name.trim()) throw badRequest('NAME_REQUIRED', '请先填写商品名称');
    const confirmed = product.facts.filter((f) => f.source === 'MERCHANT_CONFIRMED');
    if (confirmed.length === 0) throw badRequest('FACTS_REQUIRED', '请至少确认一条卖点，故事线只会使用已确认的卖点');
    const images = await this.prisma.asset.findMany({
      where: { productId: product.id, kind: 'PRODUCT', status: 'READY', origin: 'UPLOAD' },
      orderBy: { createdAt: 'asc' },
    });
    if (images.length === 0) throw badRequest('IMAGE_REQUIRED', '请至少上传一张商品图');
    onProgress?.({ phase: 'preparing' });

    const factIds = new Map(confirmed.map((f, i) => [`F${i + 1}`, f.id]));
    const previous = await this.prisma.storyline.findMany({ where: { projectId }, select: { content: true } });
    const previousTitles = previous
      .map((p) => storylineContentSchema.safeParse(p.content))
      .filter((r) => r.success)
      .map((r) => r.data!.title);

    const user = [
      `成片时长：${durationSec} 秒（4 条故事线必须全部采用此时长）`,
      `商品名称：${product.name}`,
      `品类：${product.category || '（未识别）'}`,
      `商品描述：${product.description || '（未填写）'}`,
      `目标受众：${product.targetAudience || '（未填写）'}`,
      `已确认卖点（只能使用这些信息）：\n${confirmed.map((f, i) => `F${i + 1}. ${f.text}`).join('\n')}`,
      `商品图：\n${images.map((a, i) => `${i + 1}. ${a.viewRole || '商品图'}：${a.description || '（无描述）'}`).join('\n')}`,
      `可参考的营销结构：\n${CREATIVE_PATTERNS.map((p) => `- ${p.name}（适合 ${p.fitTypes.map((t) => STORY_TYPES[t as keyof typeof STORY_TYPES]).join('、')}）：${p.beats.map((b) => b.intent).join(' → ')}`).join('\n')}`,
      direction ? `商家的方向要求：${direction}` : '商家没有指定方向。',
      previousTitles.length ? `已出现的标题（新方案要明显不同）：${previousTitles.slice(-12).join('；')}` : '',
    ]
      .filter(Boolean)
      .join('\n\n');

    let contents: StorylineContent[] = [];
    await this.llm.completeJson(
      { purpose: 'storylines', system: storylinesSystem(durationSec), user, thinking: true, maxTokens: 12000 },
      storylinesOutputSchema,
      {
        onProgress,
        validate: (data) => {
          const parsed: StorylineContent[] = [];
          for (const [i, raw] of data.storylines.entries()) {
            const r = storylineContentSchema.safeParse(raw);
            if (!r.success) {
              return `第 ${i + 1} 条故事线字段不合法：${r.error.issues.slice(0, 3).map((x) => `${x.path.join('.')} ${x.message}`).join('；')}`;
            }
            if (r.data.durationSec !== durationSec) return `4 条故事线必须全部为 ${durationSec} 秒，第 ${i + 1} 条为 ${r.data.durationSec} 秒，请按目标时长重新编排内容`;
            const problem = checkSegments(r.data);
            if (problem) return problem;
            const unknown = r.data.sellingPointIds.filter((id) => !factIds.has(id));
            if (unknown.length) return `sellingPointIds 只能使用 ${[...factIds.keys()].join('、')}，不能使用 ${unknown.join('、')}`;
            parsed.push(r.data);
          }
          if (new Set(parsed.map((p) => p.type)).size !== 4) return '4 条故事线的 type 必须各不相同';
          contents = parsed;
          return null;
        },
      },
    );

    onProgress?.({ phase: 'saving' });
    const last = await this.prisma.storyline.findFirst({ where: { projectId }, orderBy: { batch: 'desc' } });
    const batch = (last?.batch ?? 0) + 1;
    await this.prisma.$transaction([
      ...contents.map((content, position) =>
        this.prisma.storyline.create({
          data: {
            projectId,
            batch,
            position,
            direction,
            // 卖点 id 换回数据库 id
            content: { ...content, sellingPointIds: content.sellingPointIds.map((id) => factIds.get(id)!) },
          },
        }),
      ),
      this.prisma.project.update({ where: { id: projectId }, data: { targetDurationSec: durationSec, updatedAt: new Date() } }),
    ]);
    return this.projects.latestStorylines(projectId);
  }

  async requireStoryline(userId: string, storylineId: string) {
    const row = await this.prisma.storyline.findFirst({ where: { id: storylineId, project: { userId } } });
    if (!row) throw notFound('故事线');
    return row;
  }

  async update(userId: string, storylineId: string, patch: Partial<StorylineContent>) {
    const row = await this.requireStoryline(userId, storylineId);
    const current = storylineContentSchema.parse(row.content);
    const merged = { ...current, ...patch, sellingPointIds: current.sellingPointIds };
    if (patch.durationSec !== undefined && patch.durationSec !== current.durationSec) throw badRequest('DURATION_REPLAN_REQUIRED', '请回到确认卖点页选择成片时长，并重新生成故事线');
    const next = storylineContentSchema.safeParse(merged);
    if (!next.success) throw badRequest('INVALID_STORYLINE', `故事线不合法：${next.error.issues[0]?.message ?? ''}`);
    const problem = checkSegments(next.data);
    if (problem) throw badRequest('INVALID_STORYLINE', problem);
    await this.prisma.storyline.update({ where: { id: row.id }, data: { content: next.data } });
    return { id: row.id, content: next.data };
  }
}
