/**
 * 真实调用冒烟测试（会产生费用，执行前必须由产品负责人确认，D-33）。
 *
 *   npm run smoke:real -w @ai-creative/server -- --image /path/to/product.jpg --yes
 *
 * 流程：DeepSeek 素材理解 → 故事线 → 故事板（Seedream 生成人物、场景图）→ 只保留 2 个 4 秒镜头
 *      → Seedance 480p 生成 → Remotion 合成 → 重做第 2 个镜头 → 再合成。
 * 视频调用 3 次 × 4 秒 × 480p，按 06 §8.4 估算约 8.06 元；另有 Seedream 1–2 张（约 0.3 元/张）和少量 DeepSeek 费用。
 * 要用真实的公网存储时，把 MODEL_IMAGE_TRANSPORT 改为 signed_url。
 */
import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { AssetsService } from '../assets/assets.service';
import { AuthService } from '../auth/auth';
import { getEnv } from '../config/env';
import { StoryboardService } from '../creative/storyboard.service';
import { StorylinesService } from '../creative/storylines.service';
import { GenerationService } from '../generation/generation.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProductsService } from '../products/products.service';
import { ProjectsService } from '../projects/projects.service';
import { InlineRunner } from './inline-runner';

const VIDEO_CALLS = 3;
const SHOT_SEC = 4;
const PRICE_480P_PER_SEC = 0.672;

function arg(name: string) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const runner = new InlineRunner();
  const env = getEnv();
  const image = arg('--image');
  const estimate = VIDEO_CALLS * SHOT_SEC * PRICE_480P_PER_SEC;
  console.log(`预计视频费用：${VIDEO_CALLS} 次 × ${SHOT_SEC} 秒 × 480p ≈ ${estimate.toFixed(2)} 元（另有少量图片与大模型费用）`);
  if (!process.argv.includes('--yes')) {
    console.log('未加 --yes，已退出。确认预算后再执行。');
    return;
  }
  if (!image) throw new Error('请用 --image 指定一张真实的商品图');
  if (!env.ARK_API_KEY || (env.LLM_PROVIDER === 'deepseek' && !env.DEEPSEEK_API_KEY)) throw new Error('请先在 .env 中填写 ARK_API_KEY 与 DeepSeek 密钥');

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['log', 'warn', 'error'] });
  runner.attach(app);
  try {
    const { user } = await app.get(AuthService).devLogin('smoke-real');
    const projects = app.get(ProjectsService);
    const { projectId } = await projects.create(user.id, '冒烟测试商品');
    const buffer = readFileSync(image);
    await app.get(AssetsService).upload(user.id, projectId, 'PRODUCT', { buffer, size: buffer.length });
    await runner.drain();
    const products = app.get(ProductsService);
    await products.update(user.id, projectId, { name: arg('--name') ?? '冒烟测试商品' });
    await products.analyze(user.id, projectId);
    const facts = await app.get(PrismaService).productFact.findMany({ where: { product: { projects: { some: { id: projectId } } } } });
    for (const f of facts.slice(0, 2)) await products.updateFact(user.id, f.id, { confirm: true });

    const lines = await app.get(StorylinesService).generate(user.id, projectId);
    console.log('故事线：', lines.map((l) => `${l.content.title}（${l.content.durationSec}s）`).join('；'));
    const boards = app.get(StoryboardService);
    const board = await boards.generateFromStoryline(user.id, lines[0]!.id);
    await runner.drain();
    // 只保留前 2 个镜头、每个 4 秒，控制费用
    const spec = structuredClone(board.spec);
    spec.shots = spec.shots.slice(0, 2).map((s) => ({ ...s, durationSec: SHOT_SEC }));
    const trimmed = await boards.saveVersion(user.id, projectId, spec, { note: '冒烟测试：只保留 2 个镜头' });

    const generation = app.get(GenerationService);
    const job = await generation.create(user.id, projectId, { resolution: '480p', idempotencyKey: `smoke-${Date.now()}`, storyboardVersion: trimmed.version });
    await runner.runJob(job.id);
    const redo = await generation.create(user.id, projectId, {
      resolution: '480p',
      shotIds: [spec.shots[1]!.shotId],
      idempotencyKey: `smoke-redo-${Date.now()}`,
    });
    await runner.runJob(redo.id);
    console.log(`完成。查看明细：npm run inspect -- ${projectId}`);
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
