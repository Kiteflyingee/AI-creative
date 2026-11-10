import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { probe } from '../src/media/ffmpeg';
import { StorageService } from '../src/storage/storage.service';
import { auth, createTestApp, login, prepareStoryboard, resetDb, runJob, type TestContext } from './app';

describe('逐镜头生成、合成、重做与回退', () => {
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
    ctx.video.pollsQueued = 1;
    ctx.video.pollsRunning = 1;
    ctx.queue.clear();
    ctx.composer.renders.length = 0;
    token = await login(ctx, '商家');
  });

  const generate = (projectId: string, body: Record<string, unknown>) =>
    ctx.http().post(`/app/v1/projects/${projectId}/generate`).set(auth(token)).send({ resolution: '480p', ...body });
  const view = async (projectId: string) =>
    (await ctx.http().get(`/app/v1/projects/${projectId}`).set(auth(token)).expect(200)).body;

  /** 生成一条完整成片，返回项目与镜头 */
  const fullOutput = async () => {
    const { projectId, view: v } = await prepareStoryboard(ctx, token);
    const job = await generate(projectId, { idempotencyKey: 'full-key-0001' }).expect(201);
    const done = await runJob(ctx, job.body.id);
    expect(done.status).toBe('COMPLETED');
    return { projectId, shots: v.storyboard.spec.shots as Array<{ shotId: string; caption: string }> };
  };

  it('完整流程：每个镜头调用一次视频模型，转存、合成、写入 AI 标识、质检记录', async () => {
    const { projectId, shots } = await fullOutput();
    expect(ctx.video.tasks).toHaveLength(3);
    // 每个镜头的请求：9:16、480p、关闭水印、生成声音、时长与镜头一致
    for (const t of ctx.video.tasks) {
      expect(t.req.compiled.params).toMatchObject({ ratio: '9:16', resolution: '480p', duration: 5, watermark: false, generate_audio: true });
      expect(t.req.compiled.prompt).toContain('不生成字幕和水印');
      // 本地开发：商家图片以 Base64 发送
      expect(t.req.images.some((i) => i.kind === 'base64')).toBe(true);
    }
    const v = await view(projectId);
    expect(v.clips.map((c: { status: string; version: number }) => [c.status, c.version])).toEqual([
      ['SUCCEEDED', 1],
      ['SUCCEEDED', 1],
      ['SUCCEEDED', 1],
    ]);
    const output = v.outputs[0];
    expect(output).toMatchObject({ version: 1, status: 'READY', width: 480, height: 854 });
    expect(v.project.currentOutputId).toBe(output.id);
    // 字幕来自故事板，交给合成器按镜头叠加
    expect(ctx.composer.renders[0]!.captions.map((c) => c.text)).toEqual(shots.map((s) => s.caption));
    expect(ctx.composer.renders[0]!.clips.map((c) => c.durationInFrames)).toEqual([120, 120, 120]);

    // 成片文件包含 AI 生成标识（元数据）
    const dir = await mkdtemp(join(tmpdir(), 'out-'));
    try {
      const row = await ctx.prisma.output.findUniqueOrThrow({ where: { id: output.id } });
      const file = join(dir, 'v.mp4');
      await new StorageService().downloadToFile(row.objectKey!, file);
      const info = await probe(file);
      expect(info.tags.comment).toContain('AI生成');
      expect(JSON.parse(info.tags.aigc!)).toMatchObject({ Label: '1', ProduceID: output.id });
      expect(info.durationSec).toBeGreaterThan(14.5);
      expect(info.durationSec).toBeLessThan(15.5);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
    const qc = await ctx.http().get(`/app/v1/outputs/${output.id}/qc`).set(auth(token)).expect(200);
    expect(qc.body[0]).toMatchObject({ state: 'PASS' });
  });

  it('同一个幂等键只创建一个任务；进行中的任务未结束时不能再提交', async () => {
    const { projectId } = await prepareStoryboard(ctx, token);
    const a = await generate(projectId, { idempotencyKey: 'same-key-0001' }).expect(201);
    const b = await generate(projectId, { idempotencyKey: 'same-key-0001' }).expect(201);
    expect(b.body.id).toBe(a.body.id);
    expect(await ctx.prisma.generationJob.count()).toBe(1);
    expect(await ctx.prisma.clip.count()).toBe(3);
    const c = await generate(projectId, { idempotencyKey: 'other-key-0001' }).expect(409);
    expect(c.body.code).toBe('JOB_ACTIVE');
  });

  it('同时进行的视频任务不超过配置的并发数（3）', async () => {
    const { projectId } = await prepareStoryboard(ctx, token);
    // 改成 30 秒 → 6 个镜头
    await ctx.http().post(`/app/v1/projects/${projectId}/storyboard/duration`).set(auth(token)).send({ durationSec: 30 }).expect(201);
    const spec = (await view(projectId)).storyboard.spec;
    const six = [...spec.shots, ...spec.shots.map((s: { shotId: string }) => ({ ...s, shotId: `${s.shotId}_b` }))];
    six.forEach((s: { durationSec: number }) => (s.durationSec = 5));
    await ctx
      .http()
      .patch(`/app/v1/projects/${projectId}/storyboard`)
      .set(auth(token))
      .send({ expectedVersion: 2, spec: { ...spec, shots: six } })
      .expect(200);
    ctx.video.pollsQueued = 2;
    const job = await generate(projectId, { idempotencyKey: 'conc-key-0001' }).expect(201);
    await ctx.generation.tick();
    expect(ctx.video.tasks).toHaveLength(3);
    await ctx.generation.tick();
    expect(ctx.video.tasks).toHaveLength(3);
    const done = await runJob(ctx, job.body.id);
    expect(done.status).toBe('COMPLETED');
    expect(ctx.video.tasks).toHaveLength(6);
  });

  it('排队中可以取消；已经开始生成后不能取消', async () => {
    const { projectId } = await prepareStoryboard(ctx, token);
    const job = await generate(projectId, { idempotencyKey: 'cancel-key-01' }).expect(201);
    const res = await ctx.http().post(`/app/v1/jobs/${job.body.id}/cancel`).set(auth(token)).expect(201);
    expect(res.body).toMatchObject({ cancelled: 3, notCancellable: 0 });
    expect(res.body.job.status).toBe('CANCELLED');
    expect(ctx.video.createAttempts).toHaveLength(0);

    const job2 = await generate(projectId, { idempotencyKey: 'cancel-key-02' }).expect(201);
    await ctx.generation.tick(); // 提交
    await ctx.generation.tick(); // queued
    await ctx.generation.tick(); // running
    const blocked = await ctx.http().post(`/app/v1/jobs/${job2.body.id}/cancel`).set(auth(token)).expect(409);
    expect(blocked.body.code).toBe('NOT_CANCELLABLE');
  });

  it('提交时遇到限流会退避重试；参数错误直接失败并说明原因', async () => {
    const { projectId } = await prepareStoryboard(ctx, token);
    ctx.video.plans = ['submit_retryable', 'submit_fatal'];
    const job = await generate(projectId, { idempotencyKey: 'retry-key-001' }).expect(201);
    await ctx.generation.tick();
    const clips = await ctx.prisma.clip.findMany({ orderBy: { queuedAt: 'asc' } });
    const retrying = clips.find((c) => c.submitAttempts === 1 && c.status === 'QUEUED');
    expect(retrying?.nextAttemptAt).toBeTruthy();
    expect(clips.find((c) => c.status === 'FAILED')?.errorMessage).toContain('参数错误');
    // 退避时间到了以后重新提交
    await ctx.prisma.clip.update({ where: { id: retrying!.id }, data: { nextAttemptAt: new Date(Date.now() - 1000) } });
    const done = await runJob(ctx, job.body.id);
    expect(done.status).toBe('PARTIAL_FAILED');
    expect(done.errorMessage).toContain('1 个镜头生成失败');
  });

  it('部分镜头失败后保留成功的镜头，只重试失败的镜头即可合成', async () => {
    const { projectId, view: v } = await prepareStoryboard(ctx, token);
    const shots = v.storyboard.spec.shots as Array<{ shotId: string }>;
    ctx.video.plans = ['succeed', 'face_reject', 'succeed'];
    const job = await generate(projectId, { idempotencyKey: 'part-key-0001' }).expect(201);
    const done = await runJob(ctx, job.body.id);
    expect(done.status).toBe('PARTIAL_FAILED');
    const failed = await ctx.prisma.clip.findFirstOrThrow({ where: { status: 'FAILED' } });
    expect(failed.errorMessage).toContain('真人人脸');
    expect(failed.shotId).toBe(shots[1]!.shotId);

    const retry = await generate(projectId, { idempotencyKey: 'part-key-0002', shotIds: [failed.shotId] }).expect(201);
    expect(retry.body.kind).toBe('RESHOOT');
    const done2 = await runJob(ctx, retry.body.id);
    expect(done2.status).toBe('COMPLETED');
    expect(ctx.video.tasks).toHaveLength(4);
    const out = (await view(projectId)).outputs[0];
    expect(out.status).toBe('READY');
    expect((out.selection as Array<{ shotId: string }>).map((s) => s.shotId)).toEqual(shots.map((s) => s.shotId));
  });

  it('超时的镜头标为失败', async () => {
    const { projectId } = await prepareStoryboard(ctx, token);
    ctx.video.plans = ['stuck', 'succeed', 'succeed'];
    const job = await generate(projectId, { idempotencyKey: 'time-key-0001' }).expect(201);
    await ctx.generation.tick();
    await ctx.prisma.clip.updateMany({ where: { providerTaskId: 'cgt-fake-1' }, data: { submittedAt: new Date(Date.now() - 31 * 60_000) } });
    const done = await runJob(ctx, job.body.id);
    expect(done.status).toBe('PARTIAL_FAILED');
    const clip = await ctx.prisma.clip.findFirstOrThrow({ where: { providerTaskId: 'cgt-fake-1' } });
    expect(clip).toMatchObject({ status: 'FAILED', errorCode: 'TIMEOUT' });
  });

  it('视频已生成但下载转存一直失败时，重试用尽后标为失败', async () => {
    const { projectId } = await prepareStoryboard(ctx, token);
    const job = await generate(projectId, { idempotencyKey: 'xfer-key-0001' }).expect(201);
    await ctx.generation.tick();
    await ctx.generation.tick();
    await ctx.generation.tick();
    await ctx.generation.tick();
    // 把第一个片段的结果链接换成无法访问的地址
    const clip = await ctx.prisma.clip.findFirstOrThrow({ where: { status: 'TRANSFERRING' } });
    await ctx.prisma.clip.update({ where: { id: clip.id }, data: { providerVideoUrl: 'http://127.0.0.1:9/nothing.mp4' } });
    const done = await runJob(ctx, job.body.id);
    expect(done.status).toBe('PARTIAL_FAILED');
    const failed = await ctx.prisma.clip.findUniqueOrThrow({ where: { id: clip.id } });
    expect(failed).toMatchObject({ status: 'FAILED', errorCode: 'TRANSFER_FAILED' });
    expect(ctx.queue.history.filter((h) => h.name === 'transfer' && (h.data as { clipId: string }).clipId === clip.id)).toHaveLength(1);
  });

  it('修改字幕只重新合成，不调用视频模型', async () => {
    const { projectId, shots } = await fullOutput();
    const before = ctx.video.createAttempts.length;
    const res = await ctx
      .http()
      .post(`/app/v1/projects/${projectId}/captions`)
      .set(auth(token))
      .send({ captions: [{ shotId: shots[0]!.shotId, text: '新的开场字幕' }] })
      .expect(201);
    expect(res.body.status).toBe('COMPOSING');
    await ctx.queue.drain();
    expect(ctx.video.createAttempts.length).toBe(before);
    const v = await view(projectId);
    expect(v.outputs[0]).toMatchObject({ version: 2, status: 'READY', note: '修改字幕' });
    expect(ctx.composer.renders.at(-1)!.captions[0]!.text).toBe('新的开场字幕');
    expect(v.outputs[0].selection).toEqual(v.outputs[1].selection);
  });

  it('重做第 3 个镜头：只生成这一个镜头的新版本；回退后成片换回旧画面且不调用视频模型', async () => {
    const { projectId, shots } = await fullOutput();
    const third = shots[2]!.shotId;
    const v1 = await view(projectId);
    const oldClip = v1.clips.find((c: { shotId: string }) => c.shotId === third);

    const job = await generate(projectId, { idempotencyKey: 'redo-key-0001', shotIds: [third] }).expect(201);
    expect(job.body).toMatchObject({ kind: 'RESHOOT', shotIds: [third] });
    const done = await runJob(ctx, job.body.id);
    expect(done.status).toBe('COMPLETED');
    expect(ctx.video.tasks).toHaveLength(4);
    expect(ctx.video.tasks[3]!.req.compiled.params.duration).toBe(5);

    const v2 = await view(projectId);
    const thirdVersions = v2.clips.filter((c: { shotId: string }) => c.shotId === third);
    expect(thirdVersions.map((c: { version: number }) => c.version)).toEqual([1, 2]);
    expect(v2.clips.filter((c: { shotId: string }) => c.shotId !== third).every((c: { version: number }) => c.version === 1)).toBe(true);
    const current = v2.outputs[0];
    expect(current.version).toBe(2);
    const sel = (o: { selection: Array<{ shotId: string; clipId: string }> }) => Object.fromEntries(o.selection.map((s) => [s.shotId, s.clipId]));
    expect(sel(current)[third]).toBe(thirdVersions[1].id);
    expect(sel(current)[shots[0]!.shotId]).toBe(sel(v2.outputs[1])[shots[0]!.shotId]);

    const calls = ctx.video.createAttempts.length;
    await ctx.http().post(`/app/v1/projects/${projectId}/shots/${third}/select-clip`).set(auth(token)).send({ clipId: oldClip.id }).expect(201);
    await ctx.queue.drain();
    expect(ctx.video.createAttempts.length).toBe(calls);
    const v3 = await view(projectId);
    expect(v3.outputs[0]).toMatchObject({ version: 3, status: 'READY' });
    expect(sel(v3.outputs[0])[third]).toBe(oldClip.id);
    expect(v3.project.currentOutputId).toBe(v3.outputs[0].id);

    // 设为当前版本：直接切换，不重新合成
    await ctx.http().post(`/app/v1/outputs/${current.id}/make-current`).set(auth(token)).expect(201);
    expect((await view(projectId)).project.currentOutputId).toBe(current.id);
  });

  it('分享链接公开可看，显示 AI 生成；取消分享后失效', async () => {
    const { projectId } = await fullOutput();
    const outputId = (await view(projectId)).outputs[0].id;
    const share = await ctx.http().post(`/app/v1/outputs/${outputId}/share`).set(auth(token)).expect(201);
    const page = await ctx.http().get(`/app/v1/share/${share.body.token}`).expect(200);
    expect(page.body).toMatchObject({ title: '灰色猫窝', aiGenerated: true });
    expect(page.body.videoUrl).toContain('X-Amz-Signature');
    await ctx.http().delete(`/app/v1/outputs/${outputId}/share`).set(auth(token)).expect(200);
    await ctx.http().get(`/app/v1/share/${share.body.token}`).expect(404);
  });

  it('故事板在确认后又被修改时，提交会被拒绝', async () => {
    const { projectId } = await prepareStoryboard(ctx, token);
    await ctx.http().post(`/app/v1/projects/${projectId}/storyboard/duration`).set(auth(token)).send({ durationSec: 30 }).expect(201);
    const res = await generate(projectId, { idempotencyKey: 'ver-key-00001', storyboardVersion: 1 }).expect(409);
    expect(res.body.code).toBe('STORYBOARD_CHANGED');
  });
});
