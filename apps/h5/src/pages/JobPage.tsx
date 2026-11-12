import { useQuery } from '@tanstack/react-query';
import { Dialog } from 'antd-mobile';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, showError } from '../api';
import { BottomBar, FlowPage, Loading, PageHeader, Section } from '../components';
import { shotIndex, useProject } from '../hooks';
import type { JobStatus, JobView } from '../types';
import { Btn, Pill, type Tone } from '../ui/kit';

const STATUS: Record<JobStatus, string> = {
  QUEUED: '排队中',
  GENERATING: '生成中',
  COMPOSING: '合成中',
  QC: '质检中',
  COMPLETED: '已完成',
  PARTIAL_FAILED: '部分镜头失败',
  FAILED: '失败',
  CANCELLED: '已取消',
};

const CLIP_STATUS: Record<string, { text: string; tone: Tone }> = {
  QUEUED: { text: '排队中', tone: 'neutral' },
  SUBMITTING: { text: '提交中', tone: 'neutral' },
  SUBMITTED: { text: '模型排队中', tone: 'neutral' },
  RUNNING: { text: '生成中', tone: 'accent' },
  TRANSFERRING: { text: '转存中', tone: 'accent' },
  SUCCEEDED: { text: '完成', tone: 'success' },
  FAILED: { text: '失败', tone: 'danger' },
  CANCELLED: { text: '已取消', tone: 'neutral' },
};

const TERMINAL: JobStatus[] = ['COMPLETED', 'PARTIAL_FAILED', 'FAILED', 'CANCELLED'];

export function JobPage() {
  const { projectId = '', jobId = '' } = useParams();
  const navigate = useNavigate();
  const { data: view } = useProject(projectId);
  const job = useQuery({
    queryKey: ['job', jobId],
    queryFn: () => api.get<JobView>(`/app/v1/jobs/${jobId}`),
    refetchInterval: (q) => (q.state.data && TERMINAL.includes(q.state.data.status) ? false : 3000),
  });
  const [cancelling, setCancelling] = useState(false);

  if (!job.data || !view) return <Loading />;
  const j = job.data;
  const done = j.clips.filter((c) => c.status === 'SUCCEEDED').length;
  const failed = j.clips.filter((c) => c.status === 'FAILED');
  const percent = j.status === 'COMPLETED' ? 100 : Math.round((done / Math.max(1, j.clips.length)) * 85) + (['COMPOSING', 'QC'].includes(j.status) ? 10 : 0);
  const showRetry = (j.status === 'PARTIAL_FAILED' || j.status === 'FAILED') && failed.length > 0;
  const showWork = j.status === 'COMPLETED' || view.outputs.length > 0;
  const hasBar = j.status === 'QUEUED' || showRetry || showWork;

  const cancel = async () => {
    if (!(await Dialog.confirm({ content: '取消还在排队的镜头？已经开始生成的镜头无法取消。' }))) return;
    setCancelling(true);
    try {
      await api.post(`/app/v1/jobs/${jobId}/cancel`);
      await job.refetch();
    } catch (err) {
      showError(err);
    } finally {
      setCancelling(false);
    }
  };

  return (
    <FlowPage bar={hasBar}>
      <PageHeader title="生成进度" step={3} back="/" />
      <section className="ui-block ui-status">
        <div className="ui-status__top">
          <div className="ui-status__title">{STATUS[j.status]}</div>
          <div className="ui-status__pct">{percent}%</div>
        </div>
        <div className="ui-bar" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label="生成进度">
          <div className="ui-bar__fill" style={{ width: `${percent}%` }} />
        </div>
        {j.status === 'QUEUED' && j.queuedAhead > 0 && <p className="ui-caption">前面还有 {j.queuedAhead} 个镜头在排队</p>}
        <p className="ui-caption">可以离开这个页面，生成会在后台继续，回到“作品”就能看到结果。</p>
        {j.errorMessage && <p className="ui-error">{j.errorMessage}</p>}
      </section>
      <Section title="镜头" desc={`已完成 ${done} / ${j.clips.length}`}>
        <div className="ui-list">
          {j.clips.map((c) => (
            <div key={c.id} className="ui-list__row" data-testid="job-clip">
              <span className="ui-list__main">
                镜头 {shotIndex(view, c.shotId) || '?'} · 版本 {c.version}
              </span>
              <Pill tone={CLIP_STATUS[c.status]?.tone ?? 'neutral'}>{CLIP_STATUS[c.status]?.text ?? c.status}</Pill>
              {c.errorMessage && c.status === 'FAILED' && <span className="ui-error">{c.errorMessage}</span>}
            </div>
          ))}
        </div>
      </Section>
      {hasBar && (
        <BottomBar>
          {j.status === 'QUEUED' && (
            <Btn block size="lg" variant="secondary" loading={cancelling} onClick={() => void cancel()}>
              取消
            </Btn>
          )}
          {showRetry && (
            <Btn
              block
              size="lg"
              variant={showWork ? 'secondary' : 'primary'}
              onClick={() => navigate(`/p/${projectId}/confirm?shots=${failed.map((c) => c.shotId).join(',')}`)}
              data-testid="retry-failed"
            >
              只重试失败的镜头
            </Btn>
          )}
          {showWork && (
            <Btn block size="lg" variant="primary" onClick={() => navigate(`/p/${projectId}/work`)} data-testid="to-work">
              查看作品
            </Btn>
          )}
        </BottomBar>
      )}
    </FlowPage>
  );
}
