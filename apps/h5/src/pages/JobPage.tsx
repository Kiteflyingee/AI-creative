import { useQuery } from '@tanstack/react-query';
import { Button, Dialog, ProgressBar, Tag } from 'antd-mobile';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, showError } from '../api';
import { BottomBar, Loading, PageHeader, Section } from '../components';
import { shotIndex, useProject } from '../hooks';
import type { JobStatus, JobView } from '../types';

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

const CLIP_STATUS: Record<string, { text: string; color: string }> = {
  QUEUED: { text: '排队中', color: 'default' },
  SUBMITTING: { text: '提交中', color: 'default' },
  SUBMITTED: { text: '模型排队中', color: 'default' },
  RUNNING: { text: '生成中', color: 'primary' },
  TRANSFERRING: { text: '转存中', color: 'primary' },
  SUCCEEDED: { text: '完成', color: 'success' },
  FAILED: { text: '失败', color: 'danger' },
  CANCELLED: { text: '已取消', color: 'default' },
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
    <div className="page">
      <PageHeader title="生成进度" step={3} back="/" />
      <Section title={STATUS[j.status]}>
        <ProgressBar percent={percent} />
        {j.status === 'QUEUED' && j.queuedAhead > 0 && <div className="muted">前面还有 {j.queuedAhead} 个镜头在排队</div>}
        <p className="hint">可以离开这个页面，生成会在后台继续，回到“作品”就能看到结果。</p>
        {j.errorMessage && <div className="error-text">{j.errorMessage}</div>}
      </Section>
      <Section title="镜头">
        {j.clips.map((c) => (
          <div key={c.id} className="job-clip" data-testid="job-clip">
            <span>
              镜头 {shotIndex(view, c.shotId) || '?'} · 版本 {c.version}
            </span>
            <Tag color={CLIP_STATUS[c.status]?.color}>{CLIP_STATUS[c.status]?.text ?? c.status}</Tag>
            {c.errorMessage && c.status === 'FAILED' && <div className="error-text small">{c.errorMessage}</div>}
          </div>
        ))}
      </Section>
      <BottomBar>
        {j.status === 'QUEUED' && (
          <Button block loading={cancelling} onClick={() => void cancel()}>
            取消
          </Button>
        )}
        {(j.status === 'PARTIAL_FAILED' || j.status === 'FAILED') && failed.length > 0 && (
          <Button block color="primary" onClick={() => navigate(`/p/${projectId}/confirm?shots=${failed.map((c) => c.shotId).join(',')}`)} data-testid="retry-failed">
            只重试失败的镜头
          </Button>
        )}
        {(j.status === 'COMPLETED' || view.outputs.length > 0) && (
          <Button block color="primary" onClick={() => navigate(`/p/${projectId}/work`)} data-testid="to-work">
            查看作品
          </Button>
        )}
      </BottomBar>
    </div>
  );
}
