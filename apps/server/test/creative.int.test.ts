import { auth, createTestApp, login, prepareStoryboard, resetDb, testImage, uploadImage, type TestContext } from './app';
import { defaultStorylines } from './fakes';

describe('素材、故事线、故事板与对话修改', () => {
  let ctx: TestContext;
  let token: string;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => ctx.close());
  beforeEach(async () => {
    await resetDb(ctx.prisma);
    ctx.llm.reset();
    ctx.video.reset();
    ctx.queue.clear();
    ctx.images.fail = false;
    token = await login(ctx, '商家');
  });

  const newProject = async () => {
    const res = await ctx.http().post('/app/v1/projects').set(auth(token)).send({ name: '灰色猫窝' }).expect(201);
    return res.body.projectId as string;
  };
  const view = async (projectId: string) =>
    (await ctx.http().get(`/app/v1/projects/${projectId}`).set(auth(token)).expect(200)).body;

  it('上传图片按模型参考图要求校验，并说明原因', async () => {
    const projectId = await newProject();
    const small = await uploadImage(ctx, token, projectId, 'PRODUCT', { image: await testImage(200, 200), expect: 400 });
    expect(small.body.message).toContain('至少需要 300 像素');
    const thin = await uploadImage(ctx, token, projectId, 'PRODUCT', { image: await testImage(1500, 400), expect: 400 });
    expect(thin.body.message).toContain('宽高比');
    const notImage = await ctx
      .http()
      .post(`/app/v1/projects/${projectId}/assets`)
      .set(auth(token))
      .field('kind', 'PRODUCT')
      .attach('file', Buffer.from('hello'), { filename: 'a.jpg', contentType: 'image/jpeg' })
      .expect(400);
    expect(notImage.body.message).toContain('无法识别');
    const ok = await uploadImage(ctx, token, projectId, 'PRODUCT');
    expect(ok.body).toMatchObject({ kind: 'PRODUCT', status: 'READY', face: 'UNKNOWN' });
    await ctx.queue.drain();
    const v = await view(projectId);
    expect(v.assets[0]).toMatchObject({ face: 'NONE', viewRole: '正面' });
  });

  it('素材理解：AI 建议的卖点需要商家确认，未确认时不能生成故事线', async () => {
    const projectId = await newProject();
    await uploadImage(ctx, token, projectId, 'PRODUCT');
    await ctx.http().post(`/app/v1/projects/${projectId}/analyze`).set(auth(token)).expect(201);
    let v = await view(projectId);
    expect(v.product.facts).toEqual([expect.objectContaining({ text: '外罩可拆洗', source: 'AI_SUGGESTED' })]);
    expect(v.product.analysis.missingInfo).toEqual(['缺少细节图']);

    const blocked = await ctx.http().post(`/app/v1/projects/${projectId}/storylines`).set(auth(token)).send({}).expect(400);
    expect(blocked.body.code).toBe('FACTS_REQUIRED');

    await ctx.http().patch(`/app/v1/facts/${v.product.facts[0].id}`).set(auth(token)).send({ confirm: true }).expect(200);
    v = await view(projectId);
    expect(v.product.facts[0].source).toBe('MERCHANT_CONFIRMED');
    const lines = await ctx.http().post(`/app/v1/projects/${projectId}/storylines`).set(auth(token)).send({}).expect(201);
    expect(lines.body).toHaveLength(4);
    // 故事线只能引用已确认的卖点，保存时换成数据库 id
    expect(lines.body[0].content.sellingPointIds).toEqual([v.product.facts[0].id]);
  });

  it('商品名称选填：没填时素材理解按图起名并更新项目标题；商家已填的名称不改', async () => {
    const created = await ctx.http().post('/app/v1/projects').set(auth(token)).send({}).expect(201);
    const projectId = created.body.projectId as string;
    await uploadImage(ctx, token, projectId, 'PRODUCT');
    await ctx.http().post(`/app/v1/projects/${projectId}/analyze`).set(auth(token)).expect(201);
    expect(ctx.llm.calls.find((c) => c.purpose === 'analyze_product')!.user).toContain('商家未填写，请按图片起一个');
    const v = await view(projectId);
    expect(v.product.name).toBe('灰色可拆洗猫窝');
    expect(v.project.title).toBe('灰色可拆洗猫窝');
    expect(v.product.analysis.productName).toBe('灰色可拆洗猫窝');
    // 重新识别后仍记得名称是 AI 起的；商家改名后就不再算 AI 起的
    await ctx.http().post(`/app/v1/projects/${projectId}/analyze`).set(auth(token)).expect(201);
    expect((await view(projectId)).product.analysis.productName).toBe('灰色可拆洗猫窝');
    await ctx.http().patch(`/app/v1/projects/${projectId}/product`).set(auth(token)).send({ name: '猫窝' }).expect(200);
    await ctx.http().post(`/app/v1/projects/${projectId}/analyze`).set(auth(token)).expect(201);
    expect((await view(projectId)).product.analysis.productName).toBe('');

    const named = await newProject();
    await uploadImage(ctx, token, named, 'PRODUCT');
    await ctx.http().post(`/app/v1/projects/${named}/analyze`).set(auth(token)).expect(201);
    const w = await view(named);
    expect(w.product.name).toBe('灰色猫窝');
    expect(w.product.analysis.productName).toBe('');
  });

  it('卖点可以选中、取消选中和修改；改过的 AI 建议算商家写的', async () => {
    const projectId = await newProject();
    await uploadImage(ctx, token, projectId, 'PRODUCT');
    await ctx.http().post(`/app/v1/projects/${projectId}/analyze`).set(auth(token)).expect(201);
    let fact = (await view(projectId)).product.facts[0];
    expect(fact).toMatchObject({ source: 'AI_SUGGESTED', origin: 'AI', basis: '商家描述' });

    await ctx.http().patch(`/app/v1/facts/${fact.id}`).set(auth(token)).send({ confirm: true }).expect(200);
    await ctx.http().patch(`/app/v1/facts/${fact.id}`).set(auth(token)).send({ confirm: false }).expect(200);
    fact = (await view(projectId)).product.facts[0];
    expect(fact).toMatchObject({ source: 'AI_SUGGESTED', origin: 'AI' });
    // 没有选中的卖点时不能生成故事线
    expect((await ctx.http().post(`/app/v1/projects/${projectId}/storylines`).set(auth(token)).send({}).expect(400)).body.code).toBe('FACTS_REQUIRED');

    await ctx.http().patch(`/app/v1/facts/${fact.id}`).set(auth(token)).send({ text: '外罩可拆，放洗衣机直接洗' }).expect(200);
    fact = (await view(projectId)).product.facts[0];
    expect(fact).toMatchObject({ text: '外罩可拆，放洗衣机直接洗', source: 'MERCHANT_CONFIRMED', origin: 'MERCHANT', basis: '' });
  });

  it('重新识别只替换 AI 写的、没选中的建议；商家写的卖点即使没选中也保留', async () => {
    const projectId = await newProject();
    await uploadImage(ctx, token, projectId, 'PRODUCT');
    const own = await ctx.http().post(`/app/v1/projects/${projectId}/facts`).set(auth(token)).send({ text: '送一个替换外罩' }).expect(201);
    await ctx.http().patch(`/app/v1/facts/${own.body.id}`).set(auth(token)).send({ confirm: false }).expect(200);
    await ctx.http().post(`/app/v1/projects/${projectId}/analyze`).set(auth(token)).expect(201);
    ctx.llm.on('analyze_product', () => ({ productName: '', sellingPoints: [{ text: '底部防滑', basis: '图片可见' }] }));
    await ctx.http().post(`/app/v1/projects/${projectId}/analyze`).set(auth(token)).expect(201);
    const facts = (await view(projectId)).product.facts;
    expect(facts.map((f: { text: string; source: string; origin: string }) => [f.text, f.source, f.origin])).toEqual([
      ['送一个替换外罩', 'AI_SUGGESTED', 'MERCHANT'],
      ['底部防滑', 'AI_SUGGESTED', 'AI'],
    ]);
  });

  it('再次素材理解时，和上次相同但还没处理的 AI 建议不会丢失；已确认的卖点不重复建议', async () => {
    const projectId = await newProject();
    await uploadImage(ctx, token, projectId, 'PRODUCT');
    await ctx.http().post(`/app/v1/projects/${projectId}/analyze`).set(auth(token)).expect(201);
    await ctx.http().post(`/app/v1/projects/${projectId}/analyze`).set(auth(token)).expect(201);
    let v = await view(projectId);
    expect(v.product.facts).toEqual([expect.objectContaining({ text: '外罩可拆洗', source: 'AI_SUGGESTED' })]);

    await ctx.http().patch(`/app/v1/facts/${v.product.facts[0].id}`).set(auth(token)).send({ confirm: true }).expect(200);
    await ctx.http().post(`/app/v1/projects/${projectId}/analyze`).set(auth(token)).expect(201);
    v = await view(projectId);
    expect(v.product.facts).toEqual([expect.objectContaining({ text: '外罩可拆洗', source: 'MERCHANT_CONFIRMED' })]);
  });

  it('故事线引用不存在的卖点时带着错误说明重试', async () => {
    const projectId = await newProject();
    await uploadImage(ctx, token, projectId, 'PRODUCT');
    await ctx.http().post(`/app/v1/projects/${projectId}/facts`).set(auth(token)).send({ text: '外罩可拆洗' }).expect(201);
    ctx.llm.on('storylines', () => defaultStorylines('F7'), () => defaultStorylines('F1'));
    await ctx.http().post(`/app/v1/projects/${projectId}/storylines`).set(auth(token)).send({}).expect(201);
    const calls = ctx.llm.calls.filter((c) => c.purpose === 'storylines');
    expect(calls).toHaveLength(2);
    expect(calls[0]!.followUps).toEqual([]);
    // 第二次调用时把错误说明作为对话追加
    expect(JSON.stringify(calls[1]!.followUps)).toContain('sellingPointIds 只能使用 F1');
  });

  it('选定故事线后生成故事板：时长按模型能力分配，人物图、场景图由 AI 生成', async () => {
    const { view: v } = await prepareStoryboard(ctx, token);
    const spec = v.storyboard.spec;
    // 第一条故事线 15 秒，Seedance 单镜头 4–30 秒，建议 5 秒 → 3 个镜头
    expect(spec.durationSec).toBe(15);
    expect(spec.shots.map((s: { durationSec: number }) => s.durationSec)).toEqual([5, 5, 5]);
    const kinds = spec.references.map((r: { kind: string }) => r.kind).sort();
    expect(kinds).toEqual(['character', 'product', 'scene']);
    const generated = v.assets.filter((a: { origin: string }) => a.origin === 'AI_GENERATED');
    expect(generated).toHaveLength(2);
    expect(generated.every((a: { status: string }) => a.status === 'READY')).toBe(true);
    expect(ctx.images.calls).toHaveLength(2);
    // 人物、场景都是文生图（不带参考图）
    expect(ctx.images.calls.every((c) => !c.images?.length)).toBe(true);
  });

  it('修改总时长后按比例重新分配，60 秒也能分配', async () => {
    const { projectId } = await prepareStoryboard(ctx, token);
    const res = await ctx.http().post(`/app/v1/projects/${projectId}/storyboard/duration`).set(auth(token)).send({ durationSec: 60 }).expect(201);
    expect(res.body.spec.shots.map((s: { durationSec: number }) => s.durationSec)).toEqual([20, 20, 20]);
    expect(res.body.version).toBe(2);
  });

  it('镜头时长不符合模型能力时拒绝保存', async () => {
    const { projectId, view: v } = await prepareStoryboard(ctx, token);
    const spec = structuredClone(v.storyboard.spec);
    spec.shots[0].durationSec = 2;
    const res = await ctx
      .http()
      .patch(`/app/v1/projects/${projectId}/storyboard`)
      .set(auth(token))
      .send({ expectedVersion: v.storyboard.version, spec })
      .expect(400);
    expect(res.body.message).toContain('4–30 秒');
  });

  it('商品图 AI 重新生成走图生图，原图保留并可换回', async () => {
    const { projectId, view: v } = await prepareStoryboard(ctx, token);
    const product = v.storyboard.spec.references.find((r: { kind: string }) => r.kind === 'product');
    const res = await ctx
      .http()
      .post(`/app/v1/projects/${projectId}/references/${product.refId}/regenerate`)
      .set(auth(token))
      .send({ instruction: '放在木桌上' })
      .expect(201);
    const updated = res.body.spec.references.find((r: { refId: string }) => r.refId === product.refId);
    expect(updated.originalAssetId).toBe(product.assetId);
    expect(updated.assetId).not.toBe(product.assetId);
    await ctx.queue.drain();
    const call = ctx.images.calls.at(-1)!;
    expect(call.images).toHaveLength(1);
    expect(call.prompt).toContain('放在木桌上');
    expect(call.prompt).toContain('完全不变');
    const after = await view(projectId);
    expect(after.assets.find((a: { id: string }) => a.id === updated.assetId).comparison.consistent).toBe('pass');

    const back = await ctx
      .http()
      .post(`/app/v1/projects/${projectId}/references/${product.refId}/replace`)
      .set(auth(token))
      .send({ assetId: 'original' })
      .expect(201);
    const restored = back.body.spec.references.find((r: { refId: string }) => r.refId === product.refId);
    expect(restored).toMatchObject({ assetId: product.assetId, originalAssetId: null });
  });

  it('对话修改：先给出对比，点应用才生效', async () => {
    const { projectId, view: v } = await prepareStoryboard(ctx, token);
    const shot = v.storyboard.spec.shots[1];
    ctx.llm.on('chat_edit', () => ({
      reply: '把第二个镜头的口播改短',
      operations: [{ op: 'update_shot', shotId: shot.shotId, changes: { narration: '拆洗很方便' } }],
      clarification: '',
    }));
    const proposal = await ctx
      .http()
      .post(`/app/v1/projects/${projectId}/chat`)
      .set(auth(token))
      .send({ page: 'storyboard', message: '第二个镜头口播太长了' })
      .expect(201);
    expect(proposal.body.changes).toEqual([{ title: '镜头 2 · 口播', before: shot.narration, after: '拆洗很方便' }]);
    expect((await view(projectId)).storyboard.version).toBe(1);

    await ctx.http().post(`/app/v1/chat-edits/${proposal.body.id}/apply`).set(auth(token)).expect(201);
    const after = await view(projectId);
    expect(after.storyboard.version).toBe(2);
    expect(after.storyboard.spec.shots[1].narration).toBe('拆洗很方便');
    await ctx.http().post(`/app/v1/chat-edits/${proposal.body.id}/apply`).set(auth(token)).expect(409);
  });

  it('对话修改引用不存在的镜头时会重试，仍不合格则报错且不改数据', async () => {
    const { projectId } = await prepareStoryboard(ctx, token);
    ctx.llm.on('chat_edit', () => ({ reply: '', operations: [{ op: 'remove_shot', shotId: 'shot_missing' }], clarification: '' }));
    const res = await ctx.http().post(`/app/v1/projects/${projectId}/chat`).set(auth(token)).send({ page: 'storyboard', message: '删掉' }).expect(502);
    expect(res.body.code).toBe('LLM_INVALID_OUTPUT');
    expect(ctx.llm.calls.filter((c) => c.purpose === 'chat_edit')).toHaveLength(3);
    expect((await view(projectId)).storyboard.version).toBe(1);
  });

  it('作品页“重做镜头”只返回待确认的跳转，不会直接生成', async () => {
    const { projectId, view: v } = await prepareStoryboard(ctx, token);
    const shot = v.storyboard.spec.shots[2];
    ctx.llm.on('chat_edit', () => ({
      reply: '重做第三个镜头',
      operations: [{ op: 'reshoot_shot', shotId: shot.shotId, changes: { action: '猫跳进猫窝' } }],
      clarification: '',
    }));
    const proposal = await ctx.http().post(`/app/v1/projects/${projectId}/chat`).set(auth(token)).send({ page: 'work', message: '第三个镜头重做' }).expect(201);
    const applied = await ctx.http().post(`/app/v1/chat-edits/${proposal.body.id}/apply`).set(auth(token)).expect(201);
    expect(applied.body.navigate).toEqual({ page: 'confirm', shotIds: [shot.shotId] });
    expect(ctx.video.createAttempts).toHaveLength(0);
    expect(await ctx.prisma.generationJob.count()).toBe(0);
    expect((await view(projectId)).storyboard.spec.shots[2].action).toBe('猫跳进猫窝');
  });

  describe('人脸处理', () => {
    const prepareWithFace = async () => {
      ctx.llm.on('inspect_image', (req) =>
        req.user.includes('人物图')
          ? { hasHumanFace: true, quality: 'good', issues: [], viewRole: '人物', description: '真人模特' }
          : { hasHumanFace: false, quality: 'good', issues: [], viewRole: '正面', description: '商品' },
      );
      const projectId = await newProject();
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
    const generate = (projectId: string, key: string) =>
      ctx.http().post(`/app/v1/projects/${projectId}/generate`).set(auth(token)).send({ resolution: '480p', idempotencyKey: key });

    it('有真人脸且未处理时不能生成', async () => {
      const { projectId } = await prepareWithFace();
      const res = await generate(projectId, 'face-key-0001').expect(400);
      expect(res.body.code).toBe('NOT_READY');
      expect(res.body.message).toContain('真人脸');
    });

    it('选择“不用这张图”后，人物只靠文字描述，原图不会发给视频模型', async () => {
      const { projectId, personId } = await prepareWithFace();
      await ctx.http().post(`/app/v1/assets/${personId}/face`).set(auth(token)).send({ resolution: 'EXCLUDED' }).expect(201);
      await generate(projectId, 'face-key-0002').expect(201);
      const clip = await ctx.prisma.clip.findFirstOrThrow();
      const images = (clip.request as { compiled: { images: Array<{ assetId?: string }> } }).compiled.images;
      expect(images.some((i) => i.assetId === personId)).toBe(false);
      expect(images).toHaveLength(1);
    });

    it('换成虚拟人像后以 asset:// 引用', async () => {
      const { projectId, personId } = await prepareWithFace();
      await ctx
        .http()
        .post(`/app/v1/assets/${personId}/face`)
        .set(auth(token))
        .send({ resolution: 'VIRTUAL_PORTRAIT', virtualPortraitId: 'asset-20260401000000-test1' })
        .expect(201);
      const job = await generate(projectId, 'face-key-0003').expect(201);
      await ctx.generation.tick();
      expect(job.body.status).toBe('QUEUED');
      const sent = ctx.video.createAttempts[0]!;
      expect(sent.images.some((i) => i.kind === 'asset' && i.uri === 'asset://asset-20260401000000-test1')).toBe(true);
    });

    it('AI 相似人物：先描述照片风格，再文生图生成新人物替代', async () => {
      const { projectId, personId } = await prepareWithFace();
      const res = await ctx.http().post(`/app/v1/assets/${personId}/face`).set(auth(token)).send({ resolution: 'AI_SIMILAR' }).expect(201);
      const replacementId = res.body.replacementAssetId as string;
      expect(replacementId).toBeTruthy();
      // 生成完成前不能生成视频
      expect((await generate(projectId, 'face-key-0004').expect(400)).body.message).toContain('生成中');
      await ctx.queue.drain();
      const imageCall = ctx.images.calls.at(-1)!;
      expect(imageCall.images ?? []).toHaveLength(0);
      expect(imageCall.prompt).toContain('30 岁左右女性');
      await generate(projectId, 'face-key-0005').expect(201);
      const clip = await ctx.prisma.clip.findFirstOrThrow();
      const images = (clip.request as { compiled: { images: Array<{ assetId?: string }> } }).compiled.images;
      expect(images.some((i) => i.assetId === replacementId)).toBe(true);
      expect(images.some((i) => i.assetId === personId)).toBe(false);
    });

    it('商品图不能换成虚拟人像', async () => {
      const projectId = await newProject();
      const product = await uploadImage(ctx, token, projectId, 'PRODUCT');
      const res = await ctx
        .http()
        .post(`/app/v1/assets/${product.body.id}/face`)
        .set(auth(token))
        .send({ resolution: 'VIRTUAL_PORTRAIT', virtualPortraitId: 'asset-20260401000000-test1' })
        .expect(400);
      expect(res.body.code).toBe('NOT_ALLOWED');
    });
  });
});
