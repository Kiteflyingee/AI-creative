import { auth, createTestApp, login, prepareStoryboard, resetDb, uploadImage, type TestContext } from './app';
import { defaultStorylines } from './fakes';

describe('先选时长再生成故事线', () => {
  let ctx: TestContext;
  let token: string;
  beforeAll(async () => { ctx = await createTestApp(); });
  afterAll(async () => ctx.close());
  beforeEach(async () => {
    await resetDb(ctx.prisma);
    ctx.llm.reset();
    ctx.providers.reset();
    ctx.queue.clear();
    token = await login(ctx, '时长测试');
  });
  const view = async (id: string) => (await ctx.http().get(`/app/v1/projects/${id}`).set(auth(token)).expect(200)).body;
  const generate = (id: string, body: object = {}) => ctx.http().post(`/app/v1/projects/${id}/storylines`).set(auth(token)).send(body);
  async function product() {
    const created = await ctx.http().post('/app/v1/projects').set(auth(token)).send({ name: '猫窝' }).expect(201);
    const id = created.body.projectId as string;
    await uploadImage(ctx, token, id, 'PRODUCT');
    await ctx.http().post(`/app/v1/projects/${id}/facts`).set(auth(token)).send({ text: '外罩可拆洗' }).expect(201);
    await ctx.queue.drain();
    return id;
  }

  it.each([15, 30, 60])('%i 秒：4 条创意和新故事板都按选定时长规划', async (durationSec) => {
    const id = await product();
    expect((await view(id)).project.targetDurationSec).toBe(15);
    const lines = await generate(id, { durationSec }).expect(201);
    expect(lines.body).toHaveLength(4);
    expect(lines.body.every((l: {content: {durationSec: number}}) => l.content.durationSec === durationSec)).toBe(true);
    expect((await view(id)).project.targetDurationSec).toBe(durationSec);
    const call = ctx.llm.calls.find(c => c.purpose === 'storylines')!;
    expect(call.user).toContain(`成片时长：${durationSec} 秒`);
    expect(call.system).toContain(`必须全部等于 ${durationSec}`);
    const board = await ctx.http().post(`/app/v1/storylines/${lines.body[0].id}/select`).set(auth(token)).expect(201);
    expect(board.body.spec.durationSec).toBe(durationSec);
    expect(board.body.spec.shots.reduce((sum: number, s: {durationSec: number}) => sum + s.durationSec, 0)).toBe(durationSec);
    expect(ctx.video.createAttempts).toHaveLength(0);
    expect(await ctx.prisma.generationJob.count()).toBe(0);
  });

  it('改时长重新生成新批次，旧故事线、故事板和参考图不改写', async () => {
    const old = await prepareStoryboard(ctx, token);
    const oldBoard = await ctx.prisma.storyboard.findUniqueOrThrow({ where: { id: old.view.storyboard.id } });
    const assets = await ctx.prisma.asset.count();
    const images = ctx.images.calls.length;
    const lines = await generate(old.projectId, { durationSec: 30 }).expect(201);
    expect(lines.body.every((l: {content: {durationSec: number}}) => l.content.durationSec === 30)).toBe(true);
    expect(await ctx.prisma.storyline.count({where:{projectId:old.projectId}})).toBe(8);
    expect(await ctx.prisma.storyboard.findUnique({where:{id:oldBoard.id}})).toEqual(oldBoard);
    expect(await ctx.prisma.asset.count()).toBe(assets);
    expect(ctx.images.calls).toHaveLength(images);
    const stale = await ctx.http().post(`/app/v1/storylines/${old.view.storylines[0].id}/select`).set(auth(token)).expect(400);
    expect(stale.body.code).toBe('DURATION_CHANGED');
    await ctx.http().post(`/app/v1/storylines/${lines.body[0].id}/select`).set(auth(token)).expect(201);
    const boards = await ctx.prisma.storyboard.findMany({where:{projectId:old.projectId},orderBy:{version:'asc'}});
    expect(boards).toHaveLength(2);
    expect(boards[0]).toEqual(oldBoard);
    expect((boards[1].spec as {durationSec:number}).durationSec).toBe(30);
    // 换一批和对话重生成未再指定时长时，沿用项目选择。
    const next = await generate(old.projectId, {direction:'换一个创意方向'}).expect(201);
    expect(next.body.every((l: {content: {durationSec:number}}) => l.content.durationSec === 30)).toBe(true);
  });

  it('AI 混入其他时长时要求修正，不静默缩放时间段', async () => {
    const id = await product();
    ctx.llm.on('storylines', () => defaultStorylines('F1', 15), () => defaultStorylines('F1', 30));
    const lines = await generate(id, {durationSec:30}).expect(201);
    expect(lines.body.every((l: {content:{durationSec:number}}) => l.content.durationSec === 30)).toBe(true);
    const calls = ctx.llm.calls.filter(c => c.purpose === 'storylines');
    expect(calls).toHaveLength(2);
    expect(JSON.stringify(calls[1].followUps)).toContain('必须全部为 30 秒');
  });

  it('生成失败不改变已保存时长或故事线，不接受非 15/30/60 的值', async () => {
    const id = await product();
    await generate(id, {durationSec:30}).expect(201);
    ctx.llm.on('storylines', () => defaultStorylines('F1', 15));
    await generate(id, {durationSec:60}).expect(502);
    expect((await view(id)).project.targetDurationSec).toBe(30);
    expect(await ctx.prisma.storyline.count({where:{projectId:id}})).toBe(4);
    const calls=ctx.llm.calls.length;
    await generate(id, {durationSec:20}).expect(400);
    expect(ctx.llm.calls).toHaveLength(calls);
    const lines=(await view(id)).storylines;
    const changed = await ctx.http().patch(`/app/v1/storylines/${lines[0].id}`).set(auth(token)).send({durationSec:15}).expect(400);
    expect(changed.body.code).toBe('DURATION_REPLAN_REQUIRED');
  });
});
