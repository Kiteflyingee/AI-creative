import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import sharp from 'sharp';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { GenerationService } from '../src/generation/generation.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { defaultModels } from '../src/providers/registry';
import { COMPOSER, LLM_PROVIDER, PROVIDER_FACTORY } from '../src/providers/types';
import { JOB_QUEUE } from '../src/queue/job-queue';
import { buildProcessors } from '../src/queue/processors';
import { StorageService } from '../src/storage/storage.service';
import {
  FakeComposer,
  FakeLlm,
  FakeProviderFactory,
  InlineJobQueue,
  type FakeImageProvider,
  type FakeVideoProvider,
} from './fakes';

export interface TestContext {
  app: INestApplication;
  prisma: PrismaService;
  llm: FakeLlm;
  /** 所有模型的假供应商 */
  providers: FakeProviderFactory;
  /** 测试默认模型组合（Seedance 2.5 + Seedream 5.0 pro）的假供应商 */
  video: FakeVideoProvider;
  images: FakeImageProvider;
  composer: FakeComposer;
  queue: InlineJobQueue;
  generation: GenerationService;
  http: () => ReturnType<typeof request>;
  close: () => Promise<void>;
}

export async function createTestApp(): Promise<TestContext> {
  const storage = new StorageService();
  const llm = new FakeLlm();
  const providers = new FakeProviderFactory(storage);
  const composer = new FakeComposer();
  const queue = new InlineJobQueue();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(StorageService)
    .useValue(storage)
    .overrideProvider(LLM_PROVIDER)
    .useValue(llm)
    .overrideProvider(PROVIDER_FACTORY)
    .useValue(providers)
    .overrideProvider(COMPOSER)
    .useValue(composer)
    .overrideProvider(JOB_QUEUE)
    .useValue(queue)
    .compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  queue.processors = buildProcessors(app);
  const defaults = defaultModels();
  return {
    app,
    prisma: app.get(PrismaService),
    llm,
    providers,
    video: providers.videoFor(defaults.videoModel),
    images: providers.imageFor(defaults.imageModel),
    composer,
    queue,
    generation: app.get(GenerationService),
    http: () => request(app.getHttpServer()),
    close: () => app.close(),
  };
}

/** 清空测试库（User 级联删除所有业务数据） */
export async function resetDb(prisma: PrismaService) {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "User" CASCADE');
}

export async function login(ctx: TestContext, name: string): Promise<string> {
  const res = await ctx.http().post('/app/v1/auth/dev-login').send({ name }).expect(201);
  return res.body.token as string;
}

export const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

export async function testImage(width = 800, height = 1000, color = '#cccccc'): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: color } }).jpeg().toBuffer();
}

export async function uploadImage(
  ctx: TestContext,
  token: string,
  projectId: string,
  kind: string,
  opts: { image?: Buffer; expect?: number } = {},
) {
  const image = opts.image ?? (await testImage());
  return ctx
    .http()
    .post(`/app/v1/projects/${projectId}/assets`)
    .set(auth(token))
    .field('kind', kind)
    .attach('file', image, { filename: 'a.jpg', contentType: 'image/jpeg' })
    .expect(opts.expect ?? 201);
}

/** 准备到“故事板已生成、参考图已生成”的项目 */
export async function prepareStoryboard(ctx: TestContext, token: string, name = '灰色猫窝') {
  const created = await ctx.http().post('/app/v1/projects').set(auth(token)).send({ name }).expect(201);
  const projectId = created.body.projectId as string;
  await uploadImage(ctx, token, projectId, 'PRODUCT');
  await ctx.http().post(`/app/v1/projects/${projectId}/facts`).set(auth(token)).send({ text: '尺寸 50×40 厘米' }).expect(201);
  await ctx.queue.drain();
  const lines = await ctx.http().post(`/app/v1/projects/${projectId}/storylines`).set(auth(token)).send({}).expect(201);
  const storylineId = lines.body[0].id as string;
  await ctx.http().post(`/app/v1/storylines/${storylineId}/select`).set(auth(token)).expect(201);
  await ctx.queue.drain();
  const view = await ctx.http().get(`/app/v1/projects/${projectId}`).set(auth(token)).expect(200);
  return { projectId, view: view.body };
}

/** 反复执行调度与后台任务，直到任务结束 */
export async function runJob(ctx: TestContext, jobId: string, maxRounds = 40) {
  for (let i = 0; i < maxRounds; i++) {
    await ctx.queue.drain({ skip: ['tick'] });
    await ctx.generation.tick();
    await ctx.queue.drain({ skip: ['tick'] });
    const job = await ctx.prisma.generationJob.findUniqueOrThrow({ where: { id: jobId } });
    if (['COMPLETED', 'FAILED', 'PARTIAL_FAILED', 'CANCELLED'].includes(job.status)) {
      ctx.queue.jobs.splice(0, ctx.queue.jobs.length, ...ctx.queue.jobs.filter((j) => j.name !== 'tick'));
      return job;
    }
  }
  throw new Error(`任务 ${jobId} 在 ${maxRounds} 轮内没有结束`);
}
