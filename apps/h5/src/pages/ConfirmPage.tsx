import { DEFAULT_RESOLUTION, type Resolution } from '@ai-creative/shared';
import { useQuery } from '@tanstack/react-query';
import { Button, Checkbox, NoticeBar, Selector } from 'antd-mobile';
import { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, newIdempotencyKey, showError } from '../api';
import { BottomBar, Loading, PageHeader, Section } from '../components';
import { useProject } from '../hooks';
import type { JobView } from '../types';

const RES_LABEL: Record<Resolution, string> = { '480p': '480p 标清', '720p': '720p 高清', '1080p': '1080p 超清' };

/** 生成确认页（D-41）：商家确认分辨率和要生成的镜头后，才调用视频模型 */
export function ConfirmPage() {
  const { projectId = '' } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { data: view, isLoading } = useProject(projectId);
  const preset = params.get('shots')?.split(',').filter(Boolean);
  const [picked, setPicked] = useState<Resolution | null>(null);
  const [selected, setSelected] = useState<string[] | null>(preset ?? null);
  // 进入页面时生成幂等键：重复点击确认只创建一个任务
  const [idempotencyKey] = useState(newIdempotencyKey);
  const [busy, setBusy] = useState(false);

  const shots = view?.storyboard?.spec.shots ?? [];
  const shotIds = selected ?? shots.map((s) => s.shotId);
  const readiness = useQuery({
    queryKey: ['readiness', projectId, view?.storyboard?.version, shotIds.join(',')],
    queryFn: () => api.post<{ version: number; problems: string[] }>(`/app/v1/projects/${projectId}/readiness`, { shotIds }),
    enabled: Boolean(view?.storyboard) && shotIds.length > 0,
    refetchInterval: 4000,
  });

  if (isLoading || !view) return <Loading />;
  const board = view.storyboard;
  if (!board) return <Loading text="还没有故事板" />;
  const problems = readiness.data?.problems ?? [];
  // 重做镜头时默认沿用当前成片的清晰度，避免同一条视频里清晰度不一致
  const currentOutput = view.outputs.find((o) => o.id === view.project.currentOutputId);
  const resolution: Resolution = picked ?? currentOutput?.resolution ?? DEFAULT_RESOLUTION;
  const setResolution = setPicked;
  const isOutput = view.outputs.some((o) => o.status === 'READY');
  const totalSec = shots.filter((s) => shotIds.includes(s.shotId)).reduce((sum, s) => sum + s.durationSec, 0);

  const confirm = async () => {
    setBusy(true);
    try {
      const job = await api.post<JobView>(`/app/v1/projects/${projectId}/generate`, {
        resolution,
        shotIds,
        idempotencyKey,
        storyboardVersion: board.version,
      });
      navigate(`/p/${projectId}/job/${job.id}`, { replace: true });
    } catch (err) {
      showError(err);
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <PageHeader title="确认生成" step={3} back={isOutput ? `/p/${projectId}/work` : `/p/${projectId}/storyboard`} />
      <Section title="清晰度">
        <Selector
          options={view.model.resolutions.map((r) => ({ label: RES_LABEL[r], value: r }))}
          value={[resolution]}
          onChange={(v) => v[0] && setResolution(v[0])}
          data-testid="resolution"
        />
      </Section>
      <Section title={`要生成的镜头（${shotIds.length} 个，共 ${totalSec} 秒）`}>
        <Checkbox.Group value={shotIds} onChange={(v) => setSelected(v as string[])}>
          {shots.map((s, i) => (
            <div key={s.shotId} className="confirm-shot">
              <Checkbox value={s.shotId}>
                镜头 {i + 1}（{s.durationSec} 秒）：{s.action || s.subject}
              </Checkbox>
            </div>
          ))}
        </Checkbox.Group>
        <p className="hint">
          每个镜头单独生成一段带口播的视频，同时最多生成 3 个，全部完成后自动拼接并加上字幕。没选中的镜头沿用已生成的版本。
        </p>
      </Section>
      {problems.length > 0 && (
        <Section title="生成前需要处理">
          {problems.map((p) => (
            <NoticeBar key={p} content={p} color="alert" wrap />
          ))}
        </Section>
      )}
      <BottomBar>
        <Button
          block
          color="primary"
          size="large"
          loading={busy}
          disabled={shotIds.length === 0 || problems.length > 0 || readiness.isLoading}
          onClick={() => void confirm()}
          data-testid="confirm-generate"
        >
          确认生成
        </Button>
      </BottomBar>
    </div>
  );
}
