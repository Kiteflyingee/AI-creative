import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import type { ProjectView } from './types';

const ACTIVE_JOB = ['QUEUED', 'GENERATING', 'COMPOSING', 'QC'];

/** 是否有后台任务在进行（参考图生成、视频生成、合成），进行中时自动轮询 */
export function isBusy(view: ProjectView | undefined): boolean {
  if (!view) return false;
  return (
    view.assets.some((a) => a.status === 'GENERATING' || (a.origin === 'UPLOAD' && a.face === 'UNKNOWN' && !a.quality)) ||
    view.jobs.some((j) => ACTIVE_JOB.includes(j.status)) ||
    view.outputs.some((o) => o.status === 'COMPOSING')
  );
}

export function useProject(projectId: string) {
  return useQuery({
    queryKey: ['project', projectId],
    queryFn: () => api.get<ProjectView>(`/app/v1/projects/${projectId}`),
    refetchInterval: (q) => (isBusy(q.state.data) ? 3000 : false),
  });
}

export function useRefreshProject(projectId: string) {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: ['project', projectId] });
}

export function shotIndex(view: ProjectView, shotId: string): number {
  return (view.storyboard?.spec.shots.findIndex((s) => s.shotId === shotId) ?? -1) + 1;
}
