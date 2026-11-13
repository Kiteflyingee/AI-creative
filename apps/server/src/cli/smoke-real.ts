/**
 * 真实调用冒烟测试（会产生费用，执行前必须由产品负责人确认，D-33）。
 *
 *   npm run smoke:real -w @ai-creative/server -- --image /path/to/product.jpg --yes
 *
 * 使用 .env 里配置的模型组合（VIDEO_MODEL / IMAGE_MODEL）。
 * 流程：大模型素材理解 → 故事线 → 故事板（图片模型生成人物、场景图）→ 只保留 2 个最短时长的镜头
 *      → 视频模型以最低分辨率生成 → Remotion 合成 → 重做第 2 个镜头 → 再合成。
 * 视频调用 3 次。费用估算见下方 PRICE；Vertex 的项目适用单价需执行前另行核对。
 * 要用真实的公网存储时，把 MODEL_IMAGE_TRANSPORT 改为 signed_url。
 */
import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { AssetsService } from '../assets/assets.service';
import { AuthService } from '../auth/auth';
import { StoryboardService } from '../creative/storyboard.service';
import { StorylinesService } from '../creative/storylines.service';
import { GenerationService } from '../generation/generation.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProductsService } from '../products/products.service';
import { ProjectsService } from '../projects/projects.service';
import { allowedValues } from '@ai-creative/shared';
import { defaultModels, imageCapability, videoCapability } from '../providers/registry';
import { InlineRunner } from './inline-runner';
import { getEnv } from '../config/env';
import { vertexAccessToken, vertexBase } from '../providers/vertex';
import { createLlmAdapter } from '../providers/llm/factory';

const VIDEO_CALLS = 3;
/** 最低分辨率的每秒单价（只用于冒烟前的费用提示，产品内不计算费用，D-32） */
const PRICE: Record<string, { perSec: number; currency: string; note: string }> = {
  'seedance-2.5': { perSec: 0.672, currency: '元', note: '480p，06 §8.4' },
};

function arg(name: string) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const runner = new InlineRunner();
  const image = arg('--image');
  const models = defaultModels();
  const video = videoCapability(models.videoModel);
  const imageModel = imageCapability(models.imageModel);
  const resolution = video.resolutions[0]!;
  const shotSec = allowedValues(video.duration)[0]!;
  const price = PRICE[video.key];
  console.log(`模型组合：视频 ${video.label}，图片 ${imageModel.label}`);
  console.log(
    price
      ? `预计视频费用：${VIDEO_CALLS} 次 × ${shotSec} 秒 × ${resolution} ≈ ${(VIDEO_CALLS * shotSec * price.perSec).toFixed(2)} ${price.currency}（${price.note}；另有少量图片与大模型费用）`
      : `没有 ${video.label} 的单价，请先查官方价格再执行`,
  );
  if (!process.argv.includes('--yes')) {
    console.log('未加 --yes，已退出。确认预算后再执行。');
    return;
  }
  if (!image) throw new Error('请用 --image 指定一张真实的商品图');
  const env = getEnv();
  const usesVertex = [video.provider, imageModel.provider].includes('google-vertex') || env.LLM_PROVIDER === 'vertex';
  if ([video.provider, imageModel.provider].includes('volcengine-ark') && !env.ARK_API_KEY) throw new Error('请配置 ARK_API_KEY');
  if (usesVertex) {
    vertexBase();
    await vertexAccessToken();
  }
  createLlmAdapter();
  const llmKey = env.LLM_PROVIDER === 'deepseek' ? env.DEEPSEEK_API_KEY : env.LLM_PROVIDER === 'ark' ? env.ARK_API_KEY : env.LLM_API_KEY;
  if (env.LLM_PROVIDER !== 'vertex' && !llmKey) throw new Error('请配置大模型供应商密钥');

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
    // 只保留前 2 个镜头、每个用最短时长，控制费用
    const spec = structuredClone(board.spec);
    spec.shots = spec.shots.slice(0, 2).map((s) => ({ ...s, durationSec: shotSec }));
    const trimmed = await boards.saveVersion(user.id, projectId, spec, { note: '冒烟测试：只保留 2 个镜头' });

    const generation = app.get(GenerationService);
    const job = await generation.create(user.id, projectId, { resolution, idempotencyKey: `smoke-${Date.now()}`, storyboardVersion: trimmed.version });
    await runner.runJob(job.id);
    const redo = await generation.create(user.id, projectId, {
      resolution,
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
