import { auth, createTestApp, login, prepareStoryboard, resetDb, uploadImage, type TestContext } from './app';

describe('登录与用户数据隔离', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => ctx.close());
  beforeEach(async () => {
    await resetDb(ctx.prisma);
    ctx.llm.reset();
    ctx.video.reset();
    ctx.queue.clear();
  });

  it('未登录访问被拒绝', async () => {
    const res = await ctx.http().get('/app/v1/projects').expect(401);
    expect(res.body).toEqual({ code: 'UNAUTHORIZED', message: '请先登录' });
  });

  it('其他用户无法读取或修改任何资源', async () => {
    const a = await login(ctx, '商家A');
    const b = await login(ctx, '商家B');
    const { projectId, view } = await prepareStoryboard(ctx, a);
    const factId = view.product.facts[0].id as string;
    const assetId = view.assets[0].id as string;
    const storylineId = view.storylines[0].id as string;
    const refId = view.storyboard.spec.references[0].refId as string;

    const job = await ctx
      .http()
      .post(`/app/v1/projects/${projectId}/generate`)
      .set(auth(a))
      .send({ resolution: '480p', idempotencyKey: 'iso-key-0001' })
      .expect(201);
    const jobId = job.body.id as string;

    const attempts: Array<[string, string, unknown?]> = [
      ['get', `/app/v1/projects/${projectId}`],
      ['patch', `/app/v1/projects/${projectId}/product`, { name: 'x' }],
      ['post', `/app/v1/projects/${projectId}/facts`, { text: 'x' }],
      ['patch', `/app/v1/facts/${factId}`, { text: 'x' }],
      ['delete', `/app/v1/facts/${factId}`],
      ['post', `/app/v1/projects/${projectId}/analyze`],
      ['post', `/app/v1/assets/${assetId}/face`, { resolution: 'EXCLUDED' }],
      ['delete', `/app/v1/assets/${assetId}`],
      ['post', `/app/v1/projects/${projectId}/storylines`, {}],
      ['patch', `/app/v1/storylines/${storylineId}`, { title: 'x' }],
      ['post', `/app/v1/storylines/${storylineId}/select`],
      ['patch', `/app/v1/projects/${projectId}/storyboard`, { expectedVersion: 1, spec: view.storyboard.spec }],
      ['post', `/app/v1/projects/${projectId}/storyboard/duration`, { durationSec: 30 }],
      ['post', `/app/v1/projects/${projectId}/references/${refId}/regenerate`, {}],
      ['post', `/app/v1/projects/${projectId}/chat`, { page: 'storyboard', message: '改一下' }],
      ['post', `/app/v1/projects/${projectId}/generate`, { resolution: '480p', idempotencyKey: 'iso-key-0002' }],
      ['get', `/app/v1/jobs/${jobId}`],
      ['post', `/app/v1/jobs/${jobId}/cancel`],
      ['post', `/app/v1/projects/${projectId}/captions`, { captions: [{ shotId: 'x', text: 'x' }] }],
    ];
    for (const [method, url, body] of attempts) {
      const req = (ctx.http() as unknown as Record<string, (u: string) => import('supertest').Test>)[method]!(url).set(auth(b));
      const res = body === undefined ? await req : await req.send(body as object);
      expect({ url, method, status: res.status }).toEqual({ url, method, status: 404 });
    }
    // 上传到别人的项目
    await uploadImage(ctx, b, projectId, 'PRODUCT', { expect: 404 });
    // B 的项目列表为空
    const list = await ctx.http().get('/app/v1/projects').set(auth(b)).expect(200);
    expect(list.body).toEqual([]);
  });
});
