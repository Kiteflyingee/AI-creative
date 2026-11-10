import { useQuery } from '@tanstack/react-query';
import { Button, Dialog, Input, List, TabBar, Tag } from 'antd-mobile';
import { AppOutline, UserOutline, VideoOutline } from 'antd-mobile-icons';
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, clearSession, getUser, showError } from '../api';
import { AiBadge, EmptyHint, Loading } from '../components';
import type { JobStatus, ProjectView } from '../types';

interface ProjectItem {
  id: string;
  title: string;
  updatedAt: string;
  latestJobStatus: JobStatus | null;
  coverUrl: string | null;
  hasOutput: boolean;
}

const JOB_LABEL: Record<JobStatus, string> = {
  QUEUED: '排队中',
  GENERATING: '生成中',
  COMPOSING: '合成中',
  QC: '质检中',
  COMPLETED: '已完成',
  PARTIAL_FAILED: '部分失败',
  FAILED: '失败',
  CANCELLED: '已取消',
};

/** 按项目进度打开对应页面 */
export async function openProject(navigate: (to: string) => void, projectId: string) {
  try {
    const v = await api.get<ProjectView>(`/app/v1/projects/${projectId}`);
    if (v.outputs.length) navigate(`/p/${projectId}/work`);
    else if (v.jobs.length) navigate(`/p/${projectId}/job/${v.jobs[0]!.id}`);
    else if (v.storyboard) navigate(`/p/${projectId}/storyboard`);
    else if (v.storylines.length) navigate(`/p/${projectId}/storylines`);
    else navigate(`/p/${projectId}/product`);
  } catch (err) {
    showError(err);
  }
}

export function HomePage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'create';
  const user = getUser();
  const projects = useQuery({ queryKey: ['projects'], queryFn: () => api.get<ProjectItem[]>('/app/v1/projects') });
  const [creating, setCreating] = useState(false);

  const create = async () => {
    let name = '';
    const ok = await Dialog.confirm({
      title: '新建商品视频',
      content: (
        <Input placeholder="商品名称，如：灰色可拆洗猫窝" onChange={(v) => (name = v)} data-testid="new-product-name" />
      ),
      confirmText: '开始',
    });
    if (!ok) return;
    setCreating(true);
    try {
      const res = await api.post<{ projectId: string }>('/app/v1/projects', { name: name.trim() });
      navigate(`/p/${res.projectId}/product`);
    } catch (err) {
      showError(err);
    } finally {
      setCreating(false);
    }
  };

  const list = projects.data ?? [];
  const works = list.filter((p) => p.hasOutput);

  return (
    <div className="home">
      <div className="home-body">
        {tab === 'create' && (
          <>
            <div className="hero">
              <h2>做一条带货视频</h2>
              <p className="muted">上传商品图 → AI 理解卖点 → 选创意 → 定分镜 → 生成</p>
              <Button color="primary" size="large" block loading={creating} onClick={() => void create()} data-testid="new-project">
                新建商品视频
              </Button>
            </div>
            <div className="list-title">我的草稿</div>
            {projects.isLoading ? (
              <Loading />
            ) : list.length === 0 ? (
              <EmptyHint text="还没有创作" />
            ) : (
              <List>
                {list.map((p) => (
                  <List.Item
                    key={p.id}
                    onClick={() => void openProject(navigate, p.id)}
                    description={new Date(p.updatedAt).toLocaleString()}
                    extra={p.latestJobStatus ? <Tag>{JOB_LABEL[p.latestJobStatus]}</Tag> : <Tag fill="outline">草稿</Tag>}
                  >
                    {p.title}
                  </List.Item>
                ))}
              </List>
            )}
          </>
        )}
        {tab === 'works' && (
          <>
            <div className="list-title">作品</div>
            {works.length === 0 ? (
              <EmptyHint text="还没有成片" />
            ) : (
              <div className="works-grid">
                {works.map((p) => (
                  <div key={p.id} className="work-card" onClick={() => navigate(`/p/${p.id}/work`)}>
                    {p.coverUrl ? <img src={p.coverUrl} alt={p.title} /> : <div className="cover-placeholder" />}
                    <div className="work-card-title">
                      {p.title} <AiBadge />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
        {tab === 'me' && (
          <List header="我的">
            <List.Item extra={user?.name}>昵称</List.Item>
            <List.Item
              onClick={() => {
                clearSession();
                navigate('/login');
              }}
            >
              退出登录
            </List.Item>
          </List>
        )}
      </div>
      <TabBar activeKey={tab} onChange={(key) => setParams({ tab: key })} className="tab-bar">
        <TabBar.Item key="create" icon={<AppOutline />} title="创作" />
        <TabBar.Item key="works" icon={<VideoOutline />} title="作品" />
        <TabBar.Item key="me" icon={<UserOutline />} title="我的" />
      </TabBar>
    </div>
  );
}
