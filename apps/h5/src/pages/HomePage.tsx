import { useQuery } from '@tanstack/react-query';
import { Dialog, Input, SpinLoading } from 'antd-mobile';
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, clearSession, getUser, showError } from '../api';
import type { JobStatus, ProjectView } from '../types';
import { IconChevronRight, IconFilm, IconHome, IconPackage, IconPlay, IconPlus, IconSparkle } from '../ui/icons';

interface ProjectItem {
  id: string;
  title: string;
  updatedAt: string;
  latestJobStatus: JobStatus | null;
  coverUrl: string | null;
  hasOutput: boolean;
}

type Tab = 'create' | 'works' | 'me';
type Stage = 'draft' | 'running' | 'done' | 'failed';
type Filter = 'all' | Stage;

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

const RUNNING: JobStatus[] = ['QUEUED', 'GENERATING', 'COMPOSING', 'QC'];
const FAILED: JobStatus[] = ['PARTIAL_FAILED', 'FAILED', 'CANCELLED'];

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'draft', label: '草稿' },
  { key: 'running', label: '生成中' },
  { key: 'done', label: '已完成' },
  { key: 'failed', label: '需处理' },
];

type StepArtKind = 'upload' | 'pick' | 'board' | 'film';

const STEPS: { title: string; sub: string; art: StepArtKind }[] = [
  { title: '上传商品图', sub: 'AI 识别外观，整理卖点给你确认', art: 'upload' },
  { title: '选一条故事线', sub: '每次给出 4 条创意方向', art: 'pick' },
  { title: '调整分镜', sub: '逐镜脚本和参考图，一句话就能改', art: 'board' },
  { title: '生成成片', sub: '确认后逐镜头生成，自动加字幕', art: 'film' },
];

const RAIL_LIMIT = 8;

function stageOf(p: ProjectItem): Stage {
  const s = p.latestJobStatus;
  if (s && RUNNING.includes(s)) return 'running';
  if (p.hasOutput || s === 'COMPLETED') return 'done';
  if (s && FAILED.includes(s)) return 'failed';
  return 'draft';
}

function stageLabel(p: ProjectItem, stage: Stage): string {
  if (stage === 'draft') return '草稿';
  if (stage === 'done') return '已完成';
  return p.latestJobStatus ? JOB_LABEL[p.latestJobStatus] : '草稿';
}

function timeAgo(iso: string): string {
  const d = new Date(iso);
  const sec = (Date.now() - d.getTime()) / 1000;
  if (sec < 60) return '刚刚';
  if (sec < 3600) return `${Math.floor(sec / 60)} 分钟前`;
  if (sec < 86400) return `${Math.floor(sec / 3600)} 小时前`;
  if (sec < 2 * 86400) return '昨天';
  const md = `${d.getMonth() + 1}月${d.getDate()}日`;
  return d.getFullYear() === new Date().getFullYear() ? md : `${d.getFullYear()}年${md}`;
}

function initialOf(text: string | undefined, fallback: string): string {
  const first = Array.from((text ?? '').trim())[0];
  return (first ?? fallback).toUpperCase();
}

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
  const rawTab = params.get('tab');
  const tab: Tab = rawTab === 'works' || rawTab === 'me' ? rawTab : 'create';
  const setTab = (key: Tab) => setParams({ tab: key });
  const user = getUser();
  const projects = useQuery({ queryKey: ['projects'], queryFn: () => api.get<ProjectItem[]>('/app/v1/projects') });
  const [creating, setCreating] = useState(false);

  const create = async () => {
    if (creating) return;
    let name = '';
    const ok = await Dialog.confirm({
      title: '新建商品视频',
      content: (
        <div>
          <Input placeholder="商品名称，如：灰色可拆洗猫窝" onChange={(v) => (name = v)} data-testid="new-product-name" />
          <p className="ui-dialog-hint">下一步上传商品图，AI 会先帮你理解商品和卖点</p>
        </div>
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
    <div className="ui-page ui-page--dock">
      <header className="ui-topbar ui-pad">
        <div className="ui-brand" aria-label="AI 带货视频">
          <IconSparkle size={30} />
        </div>
        <button
          type="button"
          className={`ui-icon-btn ui-avatar ui-pressable${tab === 'me' ? ' is-active' : ''}`}
          aria-label="我的"
          onClick={() => setTab('me')}
        >
          {initialOf(user?.name, '我')}
        </button>
      </header>

      {tab === 'create' && (
        <CreateTab
          userName={user?.name}
          query={projects}
          list={list}
          works={works}
          creating={creating}
          onCreate={() => void create()}
          onOpen={(id) => void openProject(navigate, id)}
          onOpenWork={(id) => navigate(`/p/${id}/work`)}
          onSeeAllWorks={() => setTab('works')}
        />
      )}

      {tab === 'works' && (
        <WorksTab
          loading={projects.isLoading}
          works={works}
          onOpenWork={(id) => navigate(`/p/${id}/work`)}
          onCreate={() => void create()}
        />
      )}

      {tab === 'me' && (
        <MeTab
          name={user?.name}
          projectCount={list.length}
          workCount={works.length}
          onLogout={() => {
            clearSession();
            navigate('/login');
          }}
        />
      )}

      {/* 内容滚到导航下方时逐渐淡出，不被导航硬生生压住 */}
      <div className="ui-dock-scrim" aria-hidden="true" />
      <nav className="ui-dock" aria-label="主导航">
        <button
          type="button"
          className={`ui-dock__item${tab === 'create' ? ' is-active' : ''}`}
          aria-label="创作"
          aria-current={tab === 'create' ? 'page' : undefined}
          onClick={() => setTab('create')}
        >
          <IconHome size={24} />
        </button>
        <button
          type="button"
          className="ui-dock__item ui-dock__item--create"
          aria-label="新建商品视频"
          data-testid="nav-create"
          disabled={creating}
          onClick={() => void create()}
        >
          <IconSparkle size={30} />
        </button>
        <button
          type="button"
          className={`ui-dock__item${tab === 'works' ? ' is-active' : ''}`}
          aria-label="作品"
          aria-current={tab === 'works' ? 'page' : undefined}
          onClick={() => setTab('works')}
        >
          <IconFilm size={24} />
        </button>
      </nav>
    </div>
  );
}

function CreateTab({
  userName,
  query,
  list,
  works,
  creating,
  onCreate,
  onOpen,
  onOpenWork,
  onSeeAllWorks,
}: {
  userName: string | undefined;
  query: { isLoading: boolean; isError: boolean; refetch: () => unknown };
  list: ProjectItem[];
  works: ProjectItem[];
  creating: boolean;
  onCreate: () => void;
  onOpen: (id: string) => void;
  onOpenWork: (id: string) => void;
  onSeeAllWorks: () => void;
}) {
  const [filter, setFilter] = useState<Filter>('all');

  const counts: Record<Filter, number> = { all: list.length, draft: 0, running: 0, done: 0, failed: 0 };
  for (const p of list) counts[stageOf(p)] += 1;
  const chips = FILTERS.filter((f) => f.key === 'all' || counts[f.key] > 0);
  const active: Filter = counts[filter] > 0 ? filter : 'all';
  const shown = active === 'all' ? list : list.filter((p) => stageOf(p) === active);
  const rail = works.slice(0, RAIL_LIMIT);

  return (
    <>
      <div className="ui-greeting ui-pad">
        <h1 className="ui-display">{userName ? `你好，${userName}` : '你好'}</h1>
        <p className="ui-lead">今天想给哪件商品做一条视频？</p>
      </div>

      <div className="ui-pad">
        <button
          type="button"
          className="ui-create-bar ui-pressable"
          data-testid="new-project"
          disabled={creating}
          onClick={onCreate}
        >
          <IconPackage size={22} />
          {/* 文案不要含“开始”：端到端测试用按钮名“开始”定位新建对话框的确认按钮 */}
          <span className="ui-create-bar__text">输入商品名称，生成视频</span>
          <span className="ui-create-bar__go">
            {creating ? (
              <SpinLoading color="white" style={{ '--size': '20px' } as React.CSSProperties} />
            ) : (
              <IconSparkle size={20} />
            )}
          </span>
        </button>
      </div>

      {query.isLoading ? (
        <section className="ui-section" aria-busy="true">
          <div className="ui-section-head ui-pad">
            <h2 className="ui-title">最近成片</h2>
          </div>
          <div className="ui-rail">
            <div className="ui-skel ui-skel-card" />
            <div className="ui-skel ui-skel-card" />
          </div>
          <div className="ui-pad ui-mt-lg">
            <div className="ui-skel ui-skel-row" />
            <div className="ui-skel ui-skel-row" />
          </div>
        </section>
      ) : query.isError ? (
        <div className="ui-pad">
          <div className="ui-empty">
            <div className="ui-title">加载失败</div>
            <p className="ui-caption">网络可能不稳定，请稍后重试</p>
            <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm ui-pressable" onClick={() => void query.refetch()}>
              重试
            </button>
          </div>
        </div>
      ) : (
        <>
          <section className="ui-section">
            {rail.length > 0 ? (
              <>
                <div className="ui-section-head ui-pad">
                  <h2 className="ui-title">最近成片</h2>
                  {works.length > 1 && (
                    <button type="button" className="ui-link" onClick={onSeeAllWorks}>
                      全部
                    </button>
                  )}
                </div>
                <div className={`ui-rail${rail.length === 1 ? ' ui-rail--single' : ''}`}>
                  {rail.map((p) => (
                    <FeatureCard key={p.id} item={p} onClick={() => onOpenWork(p.id)} />
                  ))}
                </div>
              </>
            ) : (
              <StepRail hasDrafts={list.length > 0} />
            )}
          </section>

          {list.length > 0 && (
            <section className="ui-section">
              <div className="ui-section-head ui-pad">
                <h2 className="ui-title">
                  我的创作<span className="ui-section-head__count">{list.length}</span>
                </h2>
              </div>
              {chips.length > 2 && (
                <div className="ui-chips" role="tablist" aria-label="按状态筛选">
                  {chips.map((f) => (
                    <button
                      key={f.key}
                      type="button"
                      role="tab"
                      aria-selected={active === f.key}
                      className={`ui-chip${active === f.key ? ' is-active' : ''}`}
                      onClick={() => setFilter(f.key)}
                    >
                      {f.label}
                      {f.key !== 'all' && <span className="ui-chip__count">{counts[f.key]}</span>}
                    </button>
                  ))}
                </div>
              )}
              <div className="ui-rows ui-pad">
                {shown.map((p) => (
                  <ProjectRow key={p.id} item={p} onClick={() => onOpen(p.id)} />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </>
  );
}

function FeatureCard({ item, onClick }: { item: ProjectItem; onClick: () => void }) {
  return (
    <button type="button" className="ui-feature-card ui-pressable" onClick={onClick} aria-label={`打开作品：${item.title}`}>
      {item.coverUrl ? (
        <img className="ui-media" src={item.coverUrl} alt="" loading="lazy" />
      ) : (
        <span className="ui-media-blank">
          <IconSparkle size={56} />
        </span>
      )}
      <span className="ui-glass-pill ui-feature-card__tag">AI生成</span>
      <span className="ui-play">
        <IconPlay size={22} />
      </span>
      <span className="ui-feature-card__meta">
        <span className="ui-feature-card__title">{item.title}</span>
        <span className="ui-feature-card__time">{timeAgo(item.updatedAt)}</span>
      </span>
    </button>
  );
}

/** 流程示意图：只用几何图形表示每一步，不使用示例图冒充作品 */
function StepArt({ kind }: { kind: StepArtKind }) {
  if (kind === 'upload')
    return (
      <span className="ui-art">
        <span className="ui-art__photo">
          <IconPackage size={28} />
        </span>
        <span className="ui-art__badge">
          <IconPlus size={14} />
        </span>
      </span>
    );
  if (kind === 'pick')
    return (
      <span className="ui-art ui-art--pick">
        <i />
        <i className="is-on" />
        <i />
        <i />
      </span>
    );
  if (kind === 'board')
    return (
      <span className="ui-art ui-art--board">
        <i />
        <i className="is-on" />
        <i />
      </span>
    );
  return (
    <span className="ui-art">
      <span className="ui-art__screen">
        <span className="ui-art__ai">AI</span>
        <IconPlay size={18} />
      </span>
    </span>
  );
}

/** 还没有成片时：横向四步流程卡。不放按钮，这一屏的创作入口是上方的入口条和导航中间的星形 */
function StepRail({ hasDrafts }: { hasDrafts: boolean }) {
  return (
    <>
      <div className="ui-section-head ui-pad">
        <div>
          <h2 className="ui-title">四步出片</h2>
          <p className="ui-caption">{hasDrafts ? '完成一条后，成片会出现在这里' : '从一张商品图开始'}</p>
        </div>
      </div>
      <ol className="ui-step-rail" aria-label="制作流程">
        {STEPS.map((s, i) => (
          <li key={s.art} className="ui-step">
            <span className="ui-step__art">
              <StepArt kind={s.art} />
            </span>
            <span className="ui-step__num">{String(i + 1).padStart(2, '0')}</span>
            <span className="ui-step__title">{s.title}</span>
            <span className="ui-step__sub">{s.sub}</span>
          </li>
        ))}
      </ol>
    </>
  );
}

function ProjectRow({ item, onClick }: { item: ProjectItem; onClick: () => void }) {
  const stage = stageOf(item);
  return (
    <button type="button" className="ui-row" onClick={onClick}>
      <span className="ui-thumb">
        {item.coverUrl ? <img className="ui-media" src={item.coverUrl} alt="" loading="lazy" /> : initialOf(item.title, '商')}
      </span>
      <span className="ui-row__body">
        <span className="ui-row__title">{item.title}</span>
        <span className="ui-row__meta">
          <i className={`ui-dot ui-dot--${stage}`} aria-hidden="true" />
          {stageLabel(item, stage)} · {timeAgo(item.updatedAt)}
        </span>
      </span>
      <IconChevronRight size={18} className="ui-row__chev" />
    </button>
  );
}

function WorksTab({
  loading,
  works,
  onOpenWork,
  onCreate,
}: {
  loading: boolean;
  works: ProjectItem[];
  onOpenWork: (id: string) => void;
  onCreate: () => void;
}) {
  return (
    <div className="ui-pad">
      <div className="ui-greeting">
        <h1 className="ui-page-title">作品</h1>
        {works.length > 0 && <p className="ui-lead">{works.length} 条成片</p>}
      </div>
      {loading ? (
        <div className="ui-work-grid ui-mt-lg">
          <div className="ui-skel ui-work__cover" />
          <div className="ui-skel ui-work__cover" />
        </div>
      ) : works.length === 0 ? (
        <div className="ui-empty">
          <div className="ui-title">还没有成片</div>
          <p className="ui-caption">完成一条视频后会出现在这里</p>
          <button type="button" className="ui-btn ui-btn--primary ui-pressable" onClick={onCreate}>
            新建商品视频
          </button>
        </div>
      ) : (
        <div className="ui-work-grid ui-mt-lg">
          {works.map((p) => (
            <button key={p.id} type="button" className="ui-work ui-pressable" onClick={() => onOpenWork(p.id)}>
              <span className="ui-work__cover">
                {p.coverUrl ? (
                  <img className="ui-media" src={p.coverUrl} alt="" loading="lazy" />
                ) : (
                  <span className="ui-media-blank">
                    <IconSparkle size={40} />
                  </span>
                )}
                <span className="ui-glass-pill ui-glass-pill--sm ui-work__tag">AI生成</span>
              </span>
              <span className="ui-work__title">{p.title}</span>
              <span className="ui-work__time">{timeAgo(p.updatedAt)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function MeTab({
  name,
  projectCount,
  workCount,
  onLogout,
}: {
  name: string | undefined;
  projectCount: number;
  workCount: number;
  onLogout: () => void;
}) {
  return (
    <div className="ui-pad">
      <div className="ui-greeting">
        <h1 className="ui-page-title">我的</h1>
      </div>
      <div className="ui-profile">
        <div className="ui-profile__avatar" aria-hidden="true">
          {initialOf(name, '我')}
        </div>
        <div>
          <div className="ui-profile__name">{name ?? '未登录'}</div>
          <div className="ui-caption">
            {projectCount} 个项目 · {workCount} 条成片
          </div>
        </div>
      </div>
      <div className="ui-group">
        <div className="ui-group__row">
          <span>昵称</span>
          <span className="ui-group__value">{name}</span>
        </div>
        <button type="button" className="ui-group__row ui-group__row--danger" onClick={onLogout}>
          退出登录
        </button>
      </div>
    </div>
  );
}
