import { STORY_TYPES } from '@ai-creative/shared';
import { Dialog, Input, TextArea } from 'antd-mobile';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, showError } from '../api';
import { BottomBar, ChatBox, EmptyHint, FlowPage, Loading, PageHeader, Section } from '../components';
import { useProject, useRefreshProject } from '../hooks';
import { CreativeError, CreativeWaiting, useCreativeProgress } from '../CreativeProgress';
import type { ProjectView, StorylineContent } from '../types';
import { IconRefresh } from '../ui/icons';
import { Btn, cx, Field, Notice, Pill, Sheet } from '../ui/kit';

type Line = ProjectView['storylines'][number];

function EditSheet({ line, onClose, onSaved }: { line: Line | null; onClose: () => void; onSaved: () => void }) {
  const [draft, setDraft] = useState<Partial<StorylineContent>>({});
  const [busy, setBusy] = useState(false);
  if (!line) return null;
  const value = { ...line.content, ...draft };
  const save = async () => {
    setBusy(true);
    try {
      await api.patch(`/app/v1/storylines/${line.id}`, draft);
      setDraft({});
      onSaved();
      onClose();
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      visible
      onClose={onClose}
      title="编辑故事线"
      footer={
        <Btn block size="lg" variant="primary" loading={busy} onClick={() => void save()}>
          保存
        </Btn>
      }
    >
      <Field label="标题">
        <Input className="ui-input" value={value.title} onChange={(v) => setDraft({ ...draft, title: v })} maxLength={40} />
      </Field>
      <Field label="视觉风格" hint="写具体的视觉关键词，如“日系清新，色调偏暖”">
        <Input className="ui-input" value={value.style} onChange={(v) => setDraft({ ...draft, style: v })} maxLength={60} />
      </Field>
      <Field label="开场钩子">
        <TextArea className="ui-input" value={value.hook} onChange={(v) => setDraft({ ...draft, hook: v })} autoSize maxLength={80} />
      </Field>
    </Sheet>
  );
}

export function StorylinesPage() {
  const { projectId = '' } = useParams();
  const navigate = useNavigate();
  const { data: view, isLoading } = useProject(projectId);
  const refresh = useRefreshProject(projectId);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<Line | null>(null);
  const creation = useCreativeProgress();

  if (isLoading || !view) return <Loading />;
  const needsReplan = view.storylines.some((line) => line.content.durationSec !== view.project.targetDurationSec);

  const regenerate = async () => {
    let direction = '';
    const ok = await Dialog.confirm({
      title: '换一批创意',
      content: (
        <TextArea
          placeholder="可选：想要什么方向？例如“面向学生党，强调性价比，15 秒，先制造痛点再揭晓商品”"
          onChange={(v) => (direction = v)}
          autoSize={{ minRows: 3 }}
          maxLength={200}
        />
      ),
      confirmText: '生成',
    });
    if (!ok) return;
    setBusy('regenerate');
    try {
      if (!(await creation.run(`/app/v1/projects/${projectId}/storylines/stream`, { direction: direction.trim() }))) return;
      await refresh();
    } catch {
      await refresh();
    } finally {
      setBusy(null);
    }
  };

  const select = async (line: Line) => {
    if (view.storyboard && !(await Dialog.confirm({ content: '重新选择会生成新的故事板（旧版本保留）。继续吗？' }))) return;
    setBusy(line.id);
    try {
      if (!(await creation.run(`/app/v1/storylines/${line.id}/select/stream`, {}))) return;
      await refresh();
      navigate(`/p/${projectId}/storyboard`);
    } catch {
      await refresh();
    } finally {
      setBusy(null);
    }
  };

  if (busy) return (
    <FlowPage bar>
      <PageHeader title={busy === 'regenerate' ? '生成故事线' : '生成故事板'} step={busy === 'regenerate' ? 1 : 2} back={`/p/${projectId}/product`} />
      <CreativeWaiting kind={busy === 'regenerate' ? 'storylines' : 'storyboard'} events={creation.events} startedAt={creation.startedAt} durationSec={view.project.targetDurationSec} facts={view.product.facts.filter((f) => f.source === 'MERCHANT_CONFIRMED').map((f) => f.text)} title={view.storylines.find((line) => line.id === busy)?.content.title} />
      <BottomBar><Btn block size="lg" variant="primary" loading disabled>生成中</Btn></BottomBar>
    </FlowPage>
  );

  return (
    <FlowPage bar>
      <PageHeader title="选择故事线" step={1} back={`/p/${projectId}/product`} />
      <CreativeError message={creation.error} />
      <Section title={`${view.project.targetDurationSec} 秒 · 创意方向`} desc="按同一时长比较 4 条创意，选一条生成故事板；不满意可以换一批" extra={<Btn size="xs" variant="ghost" onClick={() => navigate(`/p/${projectId}/product`)}>调整时长</Btn>}>
        {needsReplan && <Notice tone="warning">现有方案的时长不一致，请返回确认卖点页，按所选 {view.project.targetDurationSec} 秒重新生成故事线</Notice>}
        {view.storylines.length === 0 && <EmptyHint text="还没有故事线" />}
        {view.storylines.map((line) => (
          <article key={line.id} className={cx('ui-story', line.selected && 'is-selected')} data-testid="storyline-card">
            <div className="ui-story__tags">
              {line.selected && <Pill tone="success">已选</Pill>}
              <Pill>{STORY_TYPES[line.content.type]}</Pill>
              <Pill>{line.content.durationSec} 秒</Pill>
            </div>
            <h3 className="ui-story__title">{line.content.title}</h3>
            <div className="ui-story__style">风格：{line.content.style}</div>
            <div className="ui-story__hook">开场：{line.content.hook}</div>
            <ol className="ui-timeline">
              {line.content.segments.map((s, i) => (
                <li key={i}>
                  <span className="ui-timeline__time">
                    {s.startSec}-{s.endSec}s
                  </span>
                  <span>{s.content}</span>
                </li>
              ))}
            </ol>
            <div className="ui-story__actions">
              <Btn size="sm" variant="surface" onClick={() => setEditing(line)}>
                编辑
              </Btn>
              <Btn
                size="sm"
                variant="primary"
                block
                loading={busy === line.id}
                disabled={Boolean(busy) || line.content.durationSec !== view.project.targetDurationSec}
                onClick={() => void select(line)}
                data-testid="select-storyline"
              >
                {line.selected ? '重新生成故事板' : '用这条'}
              </Btn>
            </div>
          </article>
        ))}
      </Section>
      <ChatBox projectId={projectId} page="storylines" onApplied={() => void refresh()} />
      <BottomBar>
        <Btn
          block
          size="lg"
          variant="secondary"
          icon={<IconRefresh size={18} />}
          loading={busy === 'regenerate'}
          disabled={Boolean(busy)}
          onClick={() => void regenerate()}
        >
          换一换
        </Btn>
        {view.storyboard && (
          <Btn block size="lg" variant="primary" onClick={() => navigate(`/p/${projectId}/storyboard`)}>
            {view.storyboard.spec.durationSec === view.project.targetDurationSec ? '查看故事板' : `查看原 ${view.storyboard.spec.durationSec} 秒故事板`}
          </Btn>
        )}
      </BottomBar>
      <EditSheet line={editing} onClose={() => setEditing(null)} onSaved={() => void refresh()} />
    </FlowPage>
  );
}
