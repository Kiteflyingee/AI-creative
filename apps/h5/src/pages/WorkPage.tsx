import { AdVideo } from '@ai-creative/composition';
import { buildCompositionInput, OUTPUT_FPS, totalFrames } from '@ai-creative/shared';
import { Player } from '@remotion/player';
import { Button, Dialog, Input, NoticeBar, Tag, Toast } from 'antd-mobile';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, showError } from '../api';
import { AiBadge, ChatBox, Loading, PageHeader, Section } from '../components';
import { useProject, useRefreshProject } from '../hooks';
import type { ClipView, OutputView } from '../types';

export function WorkPage() {
  const { projectId = '' } = useParams();
  const navigate = useNavigate();
  const { data: view, isLoading } = useProject(projectId);
  const refresh = useRefreshProject(projectId);
  const [captions, setCaptions] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [compare, setCompare] = useState<string | null>(null);

  const spec = view?.storyboard?.spec;
  useEffect(() => {
    if (spec) setCaptions(Object.fromEntries(spec.shots.map((s) => [s.shotId, s.caption])));
  }, [spec]);

  const current: OutputView | undefined = useMemo(() => {
    if (!view) return undefined;
    return view.outputs.find((o) => o.id === view.project.currentOutputId) ?? view.outputs[0];
  }, [view]);
  const latestReady = view?.outputs.find((o) => o.status === 'READY');
  const base = current?.status === 'READY' ? current : latestReady;

  const previewInput = useMemo(() => {
    if (!view || !spec || !base) return null;
    const items = spec.shots.map((s) => {
      const clipId = base.selection.find((x) => x.shotId === s.shotId)?.clipId;
      const clip = view.clips.find((c) => c.id === clipId);
      return clip?.url ? { src: clip.url, durationSec: clip.actualDurationSec ?? clip.durationSec, caption: captions[s.shotId] ?? '' } : null;
    });
    if (items.some((i) => !i)) return null;
    return buildCompositionInput(items as NonNullable<(typeof items)[number]>[], {
      fps: OUTPUT_FPS,
      width: base.width ?? 720,
      height: base.height ?? 1280,
    });
  }, [view, spec, base, captions]);

  if (isLoading || !view) return <Loading />;
  if (!spec) return <Loading text="还没有故事板" />;
  const activeJob = view.jobs.find((j) => ['QUEUED', 'GENERATING'].includes(j.status));
  const captionsChanged = spec.shots.some((s) => (captions[s.shotId] ?? '') !== s.caption);

  const run = async (key: string, fn: () => Promise<unknown>, done?: string) => {
    setBusy(key);
    try {
      await fn();
      await refresh();
      if (done) Toast.show({ content: done });
    } catch (err) {
      showError(err);
    } finally {
      setBusy(null);
    }
  };

  const saveCaptions = () =>
    run(
      'captions',
      () => api.post(`/app/v1/projects/${projectId}/captions`, { captions: spec.shots.map((s) => ({ shotId: s.shotId, text: (captions[s.shotId] ?? '').trim() })) }),
      '字幕已保存，正在重新合成（不会重新生成视频）',
    );

  const download = async (output: OutputView) => {
    try {
      const { url } = await api.get<{ url: string }>(`/app/v1/outputs/${output.id}/download-url`);
      window.location.href = url;
    } catch (err) {
      showError(err);
    }
  };

  const share = async (output: OutputView) => {
    try {
      const { token } = await api.post<{ token: string }>(`/app/v1/outputs/${output.id}/share`);
      const link = `${location.origin}/s/${token}`;
      await refresh();
      Dialog.show({
        title: '分享链接',
        content: (
          <div>
            <Input value={link} readOnly data-testid="share-link" />
            <p className="hint">打开链接无需登录，页面会标注“AI生成”。</p>
          </div>
        ),
        closeOnAction: true,
        actions: [
          [
            {
              key: 'revoke',
              text: '取消分享',
              danger: true,
              onClick: () => void run('unshare', () => api.del(`/app/v1/outputs/${output.id}/share`), '已取消分享'),
            },
            {
              key: 'copy',
              text: '复制链接',
              bold: true,
              onClick: () =>
                void navigator.clipboard
                  ?.writeText(link)
                  .then(() => Toast.show({ content: '已复制' }))
                  .catch(() => Toast.show({ content: '请手动复制链接' })),
            },
          ],
        ],
      });
    } catch (err) {
      showError(err);
    }
  };

  const clipsOf = (shotId: string) => view.clips.filter((c) => c.shotId === shotId && c.status === 'SUCCEEDED');
  const selectedClip = (shotId: string): ClipView | undefined => {
    const id = base?.selection.find((s) => s.shotId === shotId)?.clipId;
    return view.clips.find((c) => c.id === id);
  };

  return (
    <div className="page">
      <PageHeader title="作品" step={4} back="/?tab=works" />
      {activeJob && (
        <NoticeBar
          wrap
          content="有镜头正在生成，完成后会自动合成新版本"
          extra={
            <Button size="mini" onClick={() => navigate(`/p/${projectId}/job/${activeJob.id}`)}>
              查看进度
            </Button>
          }
        />
      )}

      <Section title={current ? `当前版本 v${current.version}` : '还没有成片'} extra={current?.status === 'READY' ? <AiBadge /> : undefined}>
        {current?.status === 'READY' && current.url && (
          <video className="output-video" src={current.url} poster={current.coverUrl ?? undefined} controls playsInline data-testid="output-video" />
        )}
        {current?.status === 'COMPOSING' && <Loading text="正在合成成片…" />}
        {current?.status === 'FAILED' && (
          <div>
            <div className="error-text">{current.errorMessage}</div>
            <Button size="small" onClick={() => void run('retry', () => api.post(`/app/v1/outputs/${current.id}/retry-compose`))}>
              重试合成
            </Button>
          </div>
        )}
        {current?.status === 'READY' && (
          <div className="row-gap">
            <Button size="small" onClick={() => void download(current)}>
              下载
            </Button>
            <Button size="small" onClick={() => void share(current)} data-testid="share">
              分享
            </Button>
            {current.shareToken && (
              <Button size="small" fill="none" onClick={() => void run('unshare', () => api.del(`/app/v1/outputs/${current.id}/share`), '已取消分享')}>
                取消分享
              </Button>
            )}
          </div>
        )}
        {current?.note && <div className="muted small">本版本：{current.note}</div>}
      </Section>

      <Section
        title="字幕"
        extra={
          previewInput ? (
            <Button size="small" fill="none" onClick={() => setPreview(!preview)} data-testid="caption-preview">
              {preview ? '收起预览' : '实时预览'}
            </Button>
          ) : undefined
        }
      >
        {preview && previewInput && (
          <div className="player-box" data-testid="caption-player">
            <Player
              component={AdVideo}
              inputProps={previewInput}
              durationInFrames={totalFrames(previewInput)}
              fps={previewInput.fps}
              compositionWidth={previewInput.width}
              compositionHeight={previewInput.height}
              style={{ width: '100%' }}
              controls
            />
          </div>
        )}
        {spec.shots.map((s, i) => (
          <div key={s.shotId} className="caption-row">
            <span className="caption-label">镜头 {i + 1}</span>
            <Input
              value={captions[s.shotId] ?? ''}
              onChange={(v) => setCaptions({ ...captions, [s.shotId]: v })}
              maxLength={40}
              placeholder="无字幕"
              data-testid={`caption-${i}`}
            />
          </div>
        ))}
        <Button size="small" color="primary" disabled={!captionsChanged || !base} loading={busy === 'captions'} onClick={() => void saveCaptions()} data-testid="save-captions">
          保存字幕并重新合成
        </Button>
        <p className="hint">改字幕只重新合成，不重新生成视频。</p>
      </Section>

      <Section title="镜头">
        {spec.shots.map((s, i) => {
          const versions = clipsOf(s.shotId);
          const using = selectedClip(s.shotId);
          return (
            <div key={s.shotId} className="shot-card" data-testid="work-shot">
              <div className="shot-head">
                <b>镜头 {i + 1}</b>
                <Tag>{s.durationSec} 秒</Tag>
                {using && <Tag color="success">使用版本 {using.version}</Tag>}
              </div>
              <div className="shot-field">{s.action || s.subject}</div>
              <div className="version-row">
                {versions.map((c) => (
                  <div key={c.id} className={`version ${using?.id === c.id ? 'using' : ''}`} data-testid={`version-${i}-${c.version}`}>
                    {compare === c.id && c.url ? (
                      <video src={c.url} controls autoPlay playsInline className="version-video" />
                    ) : (
                      <Button size="mini" onClick={() => setCompare(c.id)}>
                        播放 v{c.version}
                      </Button>
                    )}
                    {using?.id !== c.id && (
                      <Button
                        size="mini"
                        color="primary"
                        fill="outline"
                        loading={busy === c.id}
                        onClick={() => void run(c.id, () => api.post(`/app/v1/projects/${projectId}/shots/${s.shotId}/select-clip`, { clipId: c.id }), '正在用这个版本重新合成')}
                        data-testid={`use-version-${i}-${c.version}`}
                      >
                        使用 v{c.version}
                      </Button>
                    )}
                  </div>
                ))}
              </div>
              <Button size="small" onClick={() => navigate(`/p/${projectId}/confirm?shots=${s.shotId}`)} data-testid={`reshoot-${i}`}>
                重新生成这个镜头
              </Button>
            </div>
          );
        })}
        <Button size="small" fill="none" onClick={() => navigate(`/p/${projectId}/storyboard`)}>
          修改故事板
        </Button>
      </Section>

      <Section title="版本记录">
        {view.outputs.map((o) => (
          <div key={o.id} className="output-row" data-testid="output-row">
            <span>
              v{o.version} · {o.note || '成片'}
            </span>
            <Tag color={o.status === 'READY' ? 'success' : o.status === 'FAILED' ? 'danger' : 'default'}>
              {o.status === 'READY' ? '可用' : o.status === 'FAILED' ? '失败' : '合成中'}
            </Tag>
            {o.status === 'READY' && o.id !== view.project.currentOutputId && (
              <Button size="mini" onClick={() => void run(o.id, () => api.post(`/app/v1/outputs/${o.id}/make-current`), '已切换')}>
                设为当前
              </Button>
            )}
            {o.id === view.project.currentOutputId && <Tag color="primary">当前</Tag>}
          </div>
        ))}
      </Section>

      <ChatBox
        projectId={projectId}
        page="work"
        onApplied={(r) => {
          void refresh();
          if (r.navigate?.page === 'confirm') navigate(`/p/${projectId}/confirm?shots=${(r.navigate.shotIds ?? []).join(',')}`);
        }}
      />
    </div>
  );
}
