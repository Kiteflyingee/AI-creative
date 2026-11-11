/**
 * H5 端到端测试用的服务（只给 Playwright 使用，不是给用户的 Mock 模式，D-31）：
 * - 大模型、视频模型、图片模型使用测试代码里的假供应商，不产生费用
 * - 合成使用真实的 Remotion
 * - 后台任务在进程内循环执行
 * 使用测试数据库与测试存储桶；启动时清空测试数据。
 */
import './setup-env';
import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from '../src/app.module';
import { RemotionComposer } from '../src/compose/remotion.composer';
import { GenerationService } from '../src/generation/generation.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { COMPOSER, LLM_PROVIDER, PROVIDER_FACTORY, type LlmRequest } from '../src/providers/types';
import { JOB_QUEUE } from '../src/queue/job-queue';
import { buildProcessors } from '../src/queue/processors';
import { StorageService } from '../src/storage/storage.service';
import { FakeLlm, FakeProviderFactory, InlineJobQueue } from './fakes';

const PORT = Number(process.env.E2E_PORT ?? 3101);

function currentShots(req: LlmRequest): Array<{ shotId: string; index: number }> {
  const json = /当前内容（JSON）：\n([\s\S]*?)\n\n商家的要求/.exec(req.user)?.[1];
  return json ? ((JSON.parse(json) as { shots?: Array<{ shotId: string; index: number }> }).shots ?? []) : [];
}

async function main() {
  const storage = new StorageService();
  const llm = new FakeLlm();
  // 人物图视为含真人脸，用于验证人脸处理流程
  llm.on('inspect_image', (req) =>
    req.user.includes('人物图')
      ? { hasHumanFace: true, quality: 'good', issues: [], viewRole: '人物', description: '真人模特半身照' }
      : { hasHumanFace: false, quality: 'fair', issues: ['背景杂乱'], viewRole: '正面', description: '灰色猫窝正面' },
  );
  llm.on('chat_edit', (req) => {
    const shots = currentShots(req);
    const message = /商家的要求：(.*)$/s.exec(req.user)?.[1] ?? '';
    if (req.system.includes('“故事板”') && shots[1]) {
      return { reply: '把第二个镜头的口播改短', operations: [{ op: 'update_shot', shotId: shots[1].shotId, changes: { narration: '外罩一拉就能洗' } }], clarification: '' };
    }
    if (req.system.includes('“作品”') && message.includes('重新生成') && shots[2]) {
      return { reply: '重新生成第三个镜头', operations: [{ op: 'reshoot_shot', shotId: shots[2].shotId, changes: { action: '猫跳进猫窝蜷成一团' } }], clarification: '' };
    }
    return { reply: '', operations: [], clarification: '请说清楚要改哪里、改成什么样' };
  });
  const queue = new InlineJobQueue();

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(StorageService)
    .useValue(storage)
    .overrideProvider(LLM_PROVIDER)
    .useValue(llm)
    .overrideProvider(PROVIDER_FACTORY)
    .useValue(new FakeProviderFactory(storage))
    .overrideProvider(COMPOSER)
    .useValue(new RemotionComposer())
    .overrideProvider(JOB_QUEUE)
    .useValue(queue)
    .compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  app.enableCors({ origin: true });
  await app.init();
  await app.get(PrismaService).$executeRawUnsafe('TRUNCATE TABLE "User" CASCADE');
  queue.processors = buildProcessors(app);
  const generation = app.get(GenerationService);

  let running = false;
  setInterval(() => {
    if (running) return;
    running = true;
    void (async () => {
      try {
        await queue.drain({ skip: ['tick'] });
        await generation.tick();
        await queue.drain({ skip: ['tick'] });
        queue.jobs.splice(0, queue.jobs.length, ...queue.jobs.filter((j) => j.name !== 'tick'));
      } catch (err) {
        console.error('后台任务出错', err);
      } finally {
        running = false;
      }
    })();
  }, 1000);

  await app.listen(PORT, '0.0.0.0');
  console.log(`E2E 测试服务已启动：http://localhost:${PORT}`);
}

void main();
