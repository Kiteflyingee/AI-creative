import { Injectable } from '@nestjs/common';
import type { Asset } from '@prisma/client';
import { badRequest, notFound } from '../common/errors';
import { ANALYZE_PRODUCT_SYSTEM, analyzeProductSchema, PROMPT_VERSION } from '../creative/prompts';
import { toDataUrl, toJpeg } from '../media/image';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectsService } from '../projects/projects.service';
import { LlmService } from '../providers/llm/llm.service';
import { StorageService } from '../storage/storage.service';

export interface ProductPatch {
  name?: string;
  description?: string;
  targetAudience?: string;
}

const MAX_ANALYZE_IMAGES = 10;

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectsService,
    private readonly llm: LlmService,
    private readonly storage: StorageService,
  ) {}

  async update(userId: string, projectId: string, patch: ProductPatch) {
    const project = await this.projects.requireProject(userId, projectId);
    await this.prisma.product.update({ where: { id: project.productId }, data: patch });
    if (patch.name) await this.prisma.project.update({ where: { id: projectId }, data: { title: patch.name } });
    return { ok: true };
  }

  async addFact(userId: string, projectId: string, text: string) {
    const project = await this.projects.requireProject(userId, projectId);
    const count = await this.prisma.productFact.count({ where: { productId: project.productId } });
    // 商家自己写的卖点就是商家确认的事实
    return this.prisma.productFact.create({
      data: { productId: project.productId, text, source: 'MERCHANT_CONFIRMED', origin: 'MERCHANT', position: count },
    });
  }

  private async requireFact(userId: string, factId: string) {
    const fact = await this.prisma.productFact.findFirst({ where: { id: factId, product: { userId } } });
    if (!fact) throw notFound('卖点');
    return fact;
  }

  /**
   * 修改卖点（D-56）：
   * - confirm=true 选中、confirm=false 取消选中；只有选中的卖点能进入口播与字幕
   * - 改文字视为商家自己写的事实：自动选中，来源改为商家（不再显示 AI 的依据）
   */
  async updateFact(userId: string, factId: string, patch: { text?: string; confirm?: boolean }) {
    const fact = await this.requireFact(userId, factId);
    const edited = patch.text !== undefined && patch.text !== fact.text;
    const source = edited || patch.confirm === true ? 'MERCHANT_CONFIRMED' : patch.confirm === false ? 'AI_SUGGESTED' : fact.source;
    return this.prisma.productFact.update({
      where: { id: fact.id },
      data: {
        text: patch.text ?? fact.text,
        source,
        ...(edited ? { origin: 'MERCHANT' as const, basis: '' } : {}),
      },
    });
  }

  async removeFact(userId: string, factId: string) {
    const fact = await this.requireFact(userId, factId);
    await this.prisma.productFact.delete({ where: { id: fact.id } });
    return { ok: true };
  }

  /** 素材理解（Kickart：提炼卖点、诊断素材质量、给修改建议） */
  async analyze(userId: string, projectId: string) {
    const project = await this.projects.requireProject(userId, projectId);
    const product = await this.prisma.product.findUniqueOrThrow({
      where: { id: project.productId },
      include: { facts: true },
    });
    const assets = await this.prisma.asset.findMany({
      where: { productId: product.id, origin: 'UPLOAD', status: 'READY' },
      orderBy: { createdAt: 'asc' },
      take: MAX_ANALYZE_IMAGES,
    });
    if (!assets.some((a) => a.kind === 'PRODUCT')) throw badRequest('IMAGE_REQUIRED', '请至少上传一张商品图');
    const hasName = Boolean(product.name.trim());

    const images = await Promise.all(
      assets.map(async (a) => toDataUrl(await toJpeg(await this.storage.getBuffer(a.objectKey!), 1024, 80))),
    );
    const imageList = assets.map((a, i) => `${i + 1}. ${kindName(a)}`).join('\n');
    const user = [
      `商品名称：${hasName ? product.name : '（商家未填写，请按图片起一个）'}`,
      `商品描述：${product.description || '（未填写）'}`,
      `目标受众：${product.targetAudience || '（未填写）'}`,
      `商家已写的卖点：\n${product.facts.filter((f) => f.source === 'MERCHANT_CONFIRMED').map((f) => `- ${f.text}`).join('\n') || '（无）'}`,
      `图片（按顺序）：\n${imageList}`,
    ].join('\n\n');

    const result = await this.llm.completeJson(
      { purpose: 'analyze_product', system: ANALYZE_PRODUCT_SYSTEM, user, images },
      analyzeProductSchema,
    );

    // 保留商家选中的和商家自己写的卖点，只替换 AI 写的、商家没选的建议（D-56）。
    // 去重只对照保留下来的卖点：被替换的旧建议不能用来去重，否则同样的建议会丢失
    const replaceable = (f: { source: string; origin: string }) => f.source === 'AI_SUGGESTED' && f.origin === 'AI';
    const kept = product.facts.filter((f) => !replaceable(f));
    const existing = new Set(kept.map((f) => normalize(f.text)));
    await this.prisma.$transaction(async (tx) => {
      await tx.productFact.deleteMany({ where: { productId: product.id, source: 'AI_SUGGESTED', origin: 'AI' } });
      let position = kept.length;
      for (const point of result.sellingPoints) {
        const key = normalize(point.text);
        if (!key || existing.has(key)) continue;
        existing.add(key);
        await tx.productFact.create({
          data: { productId: product.id, text: point.text, source: 'AI_SUGGESTED', origin: 'AI', basis: point.basis, position: position++ },
        });
      }
      for (const img of result.images) {
        const asset = assets[img.index - 1];
        if (!asset) continue;
        await tx.asset.update({
          where: { id: asset.id },
          data: {
            viewRole: img.viewRole || asset.viewRole,
            description: img.description || asset.description,
            quality: { level: img.quality, issues: img.issues },
            face: img.hasHumanFace ? 'DETECTED' : asset.face === 'UNKNOWN' ? 'NONE' : asset.face,
          },
        });
      }
      // 商品名称选填（D-54）：商家没填时用 AI 起的名称，商家已填的名称不改。
      // 记下 AI 起过的名称：重新识别时名称已经有了，但只要商家没改，界面仍标“AI 填写”
      const aiName = hasName ? '' : result.productName;
      const previousAiName = (product.analysis as { productName?: string } | null)?.productName ?? '';
      const recordedAiName = aiName || (previousAiName === product.name ? previousAiName : '');
      await tx.product.update({
        where: { id: product.id },
        data: {
          ...(aiName ? { name: aiName } : {}),
          category: result.category || product.category,
          analysis: {
            productName: recordedAiName,
            missingInfo: result.missingInfo,
            suggestions: result.suggestions,
            promptVersion: PROMPT_VERSION,
          },
          analyzedAt: new Date(),
        },
      });
      if (aiName) await tx.project.update({ where: { id: project.id }, data: { title: aiName } });
    });
    return { ok: true };
  }
}

function kindName(a: Asset): string {
  return a.kind === 'PRODUCT' ? '商品图' : a.kind === 'CHARACTER' ? '人物图' : '场景图';
}

const normalize = (text: string) => text.replace(/[\s，。,.!！]/g, '').toLowerCase();
