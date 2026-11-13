import { creativeStreamEventSchema, type CreativeStreamEvent } from '@ai-creative/shared';
import { auth, createTestApp, login, resetDb, uploadImage, type TestContext } from './app';
import { defaultStorylines } from './fakes';

const events = (text: string) => text.split('\n').filter((s) => s.trim()).map((s) => creativeStreamEventSchema.parse(JSON.parse(s)));
const phases = (items: CreativeStreamEvent[]) => items.flatMap((e) => e.type === 'progress' ? [e.progress.phase] : []);

describe('创作实时进度', () => {
  let ctx: TestContext;
  let token: string;
  let projectId: string;
  beforeAll(async () => { ctx = await createTestApp(); await ctx.app.listen(0, '127.0.0.1'); });
  afterAll(async () => ctx.close());
  beforeEach(async () => {
    await resetDb(ctx.prisma);
    ctx.llm.reset(); ctx.providers.reset(); ctx.queue.clear();
    token = await login(ctx, '进度测试');
    projectId = (await ctx.http().post('/app/v1/projects').set(auth(token)).send({ name: '猫窝' }).expect(201)).body.projectId;
    await uploadImage(ctx, token, projectId, 'PRODUCT');
    await ctx.http().post(`/app/v1/projects/${projectId}/facts`).set(auth(token)).send({ text: '外罩可拆洗' }).expect(201);
    await ctx.queue.drain();
  });

  it('模型尚未完成时已经能读到进度；只保存校验后的结果，视频不自动调用', async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    ctx.llm.on('storylines', async () => { await pending; return defaultStorylines(); });
    const response = await fetch(`${await ctx.app.getUrl()}/app/v1/projects/${projectId}/storylines/stream`, {
      method: 'POST', headers: { ...auth(token), 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(10000),
    });
    expect(response.headers.get('Content-Type')).toContain('application/x-ndjson');
    const reader = response.body!.getReader();
    let text = '';
    try {
      while (!phases(events(text)).includes('generating')) {
        const next = await reader.read();
        text += new TextDecoder().decode(next.value);
      }
      expect(await ctx.prisma.storyline.count()).toBe(0);
    } finally { release(); }
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      text += new TextDecoder().decode(next.value);
    }
    expect(phases(events(text))).toEqual(['preparing', 'generating', 'validating', 'saving']);
    expect(events(text).at(-1)).toEqual({ type: 'done' });
    expect(await ctx.prisma.storyline.count()).toBe(4);
    const line = await ctx.prisma.storyline.findFirstOrThrow();
    const board = await ctx.http().post(`/app/v1/storylines/${line.id}/select/stream`).set(auth(token)).expect(200);
    expect(phases(events(board.text))).toEqual(['preparing', 'generating', 'validating', 'saving']);
    expect(await ctx.prisma.storyboard.count()).toBe(1);
    expect(ctx.video.createAttempts).toHaveLength(0);
  });

  it('校验失败时显示修正，耗尽后发送明确错误且不保存半成品', async () => {
    ctx.llm.on('storylines', () => 'SECRET_MODEL_OUTPUT');
    const response = await ctx.http().post(`/app/v1/projects/${projectId}/storylines/stream`).set(auth(token)).send({}).expect(200);
    const items = events(response.text);
    expect(phases(items).filter((p) => p === 'correcting')).toHaveLength(2);
    expect(items.at(-1)).toMatchObject({ type: 'error', code: 'LLM_INVALID_OUTPUT', status: 502 });
    expect(response.text).not.toContain('SECRET_MODEL_OUTPUT');
    expect(await ctx.prisma.storyline.count()).toBe(0);
  });

  it('浏览器断开进度流后已有请求继续完成，不重发模型调用', async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    ctx.llm.on('storylines', async () => { await pending; return defaultStorylines(); });
    const response = await fetch(`${await ctx.app.getUrl()}/app/v1/projects/${projectId}/storylines/stream`, {
      method: 'POST', headers: { ...auth(token), 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(10000),
    });
    const reader = response.body!.getReader();
    let text = '';
    try {
      while (!text.includes('generating')) text += new TextDecoder().decode((await reader.read()).value);
      await reader.cancel();
    } finally { release(); }
    for (let i = 0; i < 100 && await ctx.prisma.storyline.count() !== 4; i++) await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await ctx.prisma.storyline.count()).toBe(4);
    expect(ctx.llm.calls.filter((call) => call.purpose === 'storylines')).toHaveLength(1);
  });

  it('未登录和他人资源不调用模型；参数仍经校验', async () => {
    const count = ctx.llm.calls.length;
    await ctx.http().post(`/app/v1/projects/${projectId}/storylines/stream`).send({}).expect(401);
    await ctx.http().post(`/app/v1/projects/${projectId}/storylines/stream`).set(auth(token)).send({ durationSec: 20 }).expect(400);
    const other = await login(ctx, '另一商家');
    const response = await ctx.http().post(`/app/v1/projects/${projectId}/storylines/stream`).set(auth(other)).send({}).expect(200);
    expect(events(response.text)).toEqual([expect.objectContaining({ type: 'error', status: 404 })]);
    expect(ctx.llm.calls).toHaveLength(count);
    const lines = await ctx.http().post(`/app/v1/projects/${projectId}/storylines`).set(auth(token)).send({}).expect(201);
    const board = await ctx.http().post(`/app/v1/storylines/${lines.body[0].id}/select/stream`).set(auth(other)).expect(200);
    expect(events(board.text)).toEqual([expect.objectContaining({ type: 'error', status: 404 })]);
    expect(await ctx.prisma.storyboard.count()).toBe(0);
  });
});
