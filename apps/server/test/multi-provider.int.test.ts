import { resetEnvCache } from '../src/config/env';
import { auth, createTestApp, login, prepareStoryboard, resetDb, runJob, uploadImage, type TestContext } from './app';

/** 切换“新建项目使用的模型组合”（相当于修改服务端配置） */
function useModels(video: string, image: string) {
  process.env.VIDEO_MODEL = video;
  process.env.IMAGE_MODEL = image;
  resetEnvCache();
}

const SEEDANCE = ['seedance-2.5', 'seedream-5.0-pro'] as const;
const GOOGLE = ['gemini-omni-1.2-flash', 'nano-banana-2.1'] as const;

describe('多供应商并存：Seedance/Seedream 与 Gemini Omni/Nano Banana', () => {
  let ctx: TestContext;
  let token: string;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    useModels(...SEEDANCE);
    await ctx.close();
  });
  beforeEach(async () => {
    useModels(...SEEDANCE);
    await resetDb(ctx.prisma);
    ctx.llm.reset();
    ctx.providers.reset();
    ctx.queue.clear();
    ctx.composer.renders.length = 0;
    token = await login(ctx, '商家');
  });

  const omni = () => ctx.providers.videoFor(GOOGLE[0]);
  const nano = () => ctx.providers.imageFor(GOOGLE[1]);
  const generate = (projectId: string, body: Record<string, unknown>) =>
    ctx.http().post(`/app/v1/projects/${projectId}/generate`).set(auth(token)).send(body);
  const view = async (projectId: string) => (await ctx.http().get(`/app/v1/projects/${projectId}`).set(auth(token)).expect(200)).body;

  it('Google 组合：参考图由 Nano Banana 生成，每个镜头调用一次 Omni，转存后删除 Google 侧记录', async () => {
    useModels(...GOOGLE);
    const { projectId, view: v } = await prepareStoryboard(ctx, token);
    // 商家不选模型；页面只拿到该模型的时长规则和分辨率，没有 480p，也没有虚拟人像
    expect(v.model).toMatchObject({ resolutions: ['720p', '1080p'], duration: { min: 3, max: 15 } });
    expect(v.virtualPortraits).toEqual([]);
    expect(nano().calls.length).toBeGreaterThan(0);
    expect(ctx.images.calls).toHaveLength(0);
    // 人物、场景图按 Nano Banana 返回的 PNG 原样保存
    const generated = v.assets.filter((a: { origin: string }) => a.origin === 'AI_GENERATED');
    expect(generated.length).toBeGreaterThan(0);
    const row = await ctx.prisma.asset.findFirstOrThrow({ where: { origin: 'AI_GENERATED' } });
    expect(row).toMatchObject({ mime: 'image/png', providerModelId: 'gemini-nano-banana-2.1' });
    expect(row.objectKey).toMatch(/\.png$/);

    await generate(projectId, { resolution: '480p', idempotencyKey: 'g-480-0001' }).expect(400);
    const job = await generate(projectId, { resolution: '720p', idempotencyKey: 'g-720-0001' }).expect(201);
    const done = await runJob(ctx, job.body.id);
    expect(done.status).toBe('COMPLETED');

    expect(ctx.video.tasks).toHaveLength(0);
    expect(omni().tasks).toHaveLength(3);
    for (const t of omni().tasks) {
      expect(t.req.compiled.params).toEqual({ aspect_ratio: '9:16', resolution: '720p', duration: '5s' });
      expect(t.req.compiled.prompt).toContain('A single continuous shot with no scene cuts');
      expect(t.req.compiled.prompt).toContain('Do not render subtitles');
      expect(t.req.images.every((i) => i.kind === 'base64')).toBe(true);
    }
    // 转存顺序取决于轮询顺序，这里只比较集合
    expect([...omni().cleaned].sort()).toEqual(omni().tasks.map((t) => t.id).sort());
    const clips = await ctx.prisma.clip.findMany();
    expect(clips.every((c) => c.provider === 'google-gemini' && c.modelKey === 'gemini-omni-1.2-flash' && c.status === 'SUCCEEDED')).toBe(true);
    const out = (await view(projectId)).outputs[0];
    expect(out).toMatchObject({ status: 'READY', width: 720, height: 1280 });
  });

  it('改配置只影响新建项目：已有项目继续用创建时的模型（含重做镜头）', async () => {
    const a = await prepareStoryboard(ctx, token, '项目A');
    useModels(...GOOGLE);
    const b = await prepareStoryboard(ctx, token, '项目B');
    expect((await ctx.prisma.project.findUniqueOrThrow({ where: { id: a.projectId } })).videoModel).toBe('seedance-2.5');
    expect((await ctx.prisma.project.findUniqueOrThrow({ where: { id: b.projectId } })).videoModel).toBe('gemini-omni-1.2-flash');

    // 配置已经切到 Google，项目 A 仍然用 Seedance，480p 仍可用，虚拟人像仍显示
    expect(a.view.model.resolutions).toContain('480p');
    expect((await view(a.projectId)).virtualPortraits).toHaveLength(1);
    const job = await generate(a.projectId, { resolution: '480p', idempotencyKey: 'a-full-0001' }).expect(201);
    expect((await runJob(ctx, job.body.id)).status).toBe('COMPLETED');
    expect(ctx.video.tasks).toHaveLength(3);
    expect(omni().tasks).toHaveLength(0);

    const third = a.view.storyboard.spec.shots[2].shotId as string;
    const redo = await generate(a.projectId, { resolution: '480p', shotIds: [third], idempotencyKey: 'a-redo-0001' }).expect(201);
    expect((await runJob(ctx, redo.body.id)).status).toBe('COMPLETED');
    expect(ctx.video.tasks).toHaveLength(4);
    expect(omni().tasks).toHaveLength(0);

    // 故事板改时长也按项目自己的模型规则：Seedance 单镜头最短 4 秒，3 秒不合法
    const boardA = (await view(a.projectId)).storyboard;
    boardA.spec.shots[0].durationSec = 3;
    const bad = await ctx
      .http()
      .patch(`/app/v1/projects/${a.projectId}/storyboard`)
      .set(auth(token))
      .send({ expectedVersion: boardA.version, spec: boardA.spec })
      .expect(400);
    expect(bad.body.code).toBe('DURATION_INVALID');
    const boardB = (await view(b.projectId)).storyboard;
    boardB.spec.shots[0].durationSec = 3;
    boardB.spec.shots[1].durationSec = 7;
    await ctx
      .http()
      .patch(`/app/v1/projects/${b.projectId}/storyboard`)
      .set(auth(token))
      .send({ expectedVersion: boardB.version, spec: boardB.spec })
      .expect(200);
  });

  it('并发按供应商分别计算：一家满了不影响另一家', async () => {
    const a = await prepareStoryboard(ctx, token, '项目A');
    useModels(...GOOGLE);
    const b = await prepareStoryboard(ctx, token, '项目B');
    ctx.video.pollsQueued = 5;
    omni().pollsQueued = 5;
    const jobB = await generate(b.projectId, { resolution: '720p', idempotencyKey: 'b-conc-0001' }).expect(201);
    const jobA = await generate(a.projectId, { resolution: '480p', idempotencyKey: 'a-conc-0001' }).expect(201);
    await ctx.generation.tick();
    // 测试配置：火山并发 3，Gemini 并发 2；B 先排队，但只占用 Gemini 的并发位
    expect(omni().tasks).toHaveLength(2);
    expect(ctx.video.tasks).toHaveLength(3);
    await ctx.generation.tick();
    expect(omni().tasks).toHaveLength(2);
    expect((await runJob(ctx, jobB.body.id)).status).toBe('COMPLETED');
    expect((await runJob(ctx, jobA.body.id)).status).toBe('COMPLETED');
    expect(omni().tasks).toHaveLength(3);
  });

  describe('人脸处理按模型区分', () => {
    const prepareWithFace = async () => {
      ctx.llm.on('inspect_image', (req) =>
        req.user.includes('人物图')
          ? { hasHumanFace: true, quality: 'good', issues: [], viewRole: '人物', description: '真人模特' }
          : { hasHumanFace: false, quality: 'good', issues: [], viewRole: '正面', description: '商品' },
      );
      const created = await ctx.http().post('/app/v1/projects').set(auth(token)).send({ name: '有人脸' }).expect(201);
      const projectId = created.body.projectId as string;
      await uploadImage(ctx, token, projectId, 'PRODUCT');
      const person = await uploadImage(ctx, token, projectId, 'CHARACTER');
      await ctx.http().post(`/app/v1/projects/${projectId}/facts`).set(auth(token)).send({ text: '外罩可拆洗' }).expect(201);
      await ctx.queue.drain();
      ctx.llm.on('storyboard', () => ({
        styleProfile: '清新',
        voiceProfile: '女声',
        characters: [{ key: 'C1', name: '模特', description: '', imagePrompt: '' }],
        scenes: [],
        shots: [1, 2, 3].map((i) => ({ action: `动作${i}`, narration: '你好', caption: '字幕', durationSec: 5, refs: ['P1', 'C1'] })),
      }));
      const lines = await ctx.http().post(`/app/v1/projects/${projectId}/storylines`).set(auth(token)).send({}).expect(201);
      await ctx.http().post(`/app/v1/storylines/${lines.body[0].id}/select`).set(auth(token)).expect(201);
      await ctx.queue.drain();
      return { projectId, personId: person.body.id as string };
    };

    it('Gemini 项目不能选虚拟人像；提示里也不出现虚拟人像', async () => {
      useModels(...GOOGLE);
      const { projectId, personId } = await prepareWithFace();
      const blocked = await generate(projectId, { resolution: '720p', idempotencyKey: 'face-g-0001' }).expect(400);
      expect(blocked.body.message).toContain('真人脸');
      expect(blocked.body.message).not.toContain('虚拟人像');
      const res = await ctx
        .http()
        .post(`/app/v1/assets/${personId}/face`)
        .set(auth(token))
        .send({ resolution: 'VIRTUAL_PORTRAIT', virtualPortraitId: 'asset-20260401000000-test1' })
        .expect(400);
      expect(res.body.code).toBe('NOT_SUPPORTED');
    });

    it('Gemini 项目选 AI 相似人物：Nano Banana 文生图生成新人物，发给 Omni 的是新人物而不是原图', async () => {
      useModels(...GOOGLE);
      const { projectId, personId } = await prepareWithFace();
      const res = await ctx.http().post(`/app/v1/assets/${personId}/face`).set(auth(token)).send({ resolution: 'AI_SIMILAR' }).expect(201);
      await ctx.queue.drain();
      expect(nano().calls.at(-1)!.images ?? []).toHaveLength(0);
      await generate(projectId, { resolution: '720p', idempotencyKey: 'face-g-0002' }).expect(201);
      const clip = await ctx.prisma.clip.findFirstOrThrow();
      const images = (clip.request as { compiled: { images: Array<{ assetId?: string }> } }).compiled.images;
      expect(images.some((i) => i.assetId === res.body.replacementAssetId)).toBe(true);
      expect(images.some((i) => i.assetId === personId)).toBe(false);
    });

    it('Seedance 只信任同账号 Seedream 生成的人物图：组合配成 Seedance + Nano Banana 时，生成前提示重新生成人物', async () => {
      useModels('seedance-2.5', 'nano-banana-2.1');
      const { projectId } = await prepareStoryboard(ctx, token, '混搭组合');
      const res = await generate(projectId, { resolution: '480p', idempotencyKey: 'mix-key-0001' }).expect(400);
      expect(res.body.code).toBe('NOT_READY');
      expect(res.body.message).toContain('不是用当前视频模型认可的图片模型生成的');
    });
  });
});
