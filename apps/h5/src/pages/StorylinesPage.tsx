import { STORY_DURATIONS, STORY_TYPES } from '@ai-creative/shared';
import { Button, Dialog, Form, Input, Popup, Selector, Tag, TextArea } from 'antd-mobile';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, showError } from '../api';
import { BottomBar, ChatBox, EmptyHint, Loading, PageHeader } from '../components';
import { useProject, useRefreshProject } from '../hooks';
import type { ProjectView, StorylineContent } from '../types';

type Line = ProjectView['storylines'][number];

function EditPopup({ line, onClose, onSaved }: { line: Line | null; onClose: () => void; onSaved: () => void }) {
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
    <Popup visible onMaskClick={onClose} bodyStyle={{ borderRadius: '12px 12px 0 0', maxHeight: '80vh', overflow: 'auto' }}>
      <div className="popup-body">
        <Form layout="vertical">
          <Form.Item label="标题">
            <Input value={value.title} onChange={(v) => setDraft({ ...draft, title: v })} maxLength={40} />
          </Form.Item>
          <Form.Item label="视觉风格" help="写具体的视觉关键词，如“日系清新，色调偏暖”">
            <Input value={value.style} onChange={(v) => setDraft({ ...draft, style: v })} maxLength={60} />
          </Form.Item>
          <Form.Item label="开场钩子">
            <TextArea value={value.hook} onChange={(v) => setDraft({ ...draft, hook: v })} autoSize maxLength={80} />
          </Form.Item>
          <Form.Item label="时长">
            <Selector
              options={STORY_DURATIONS.map((d) => ({ label: `${d} 秒`, value: d }))}
              value={[value.durationSec]}
              onChange={(v) => v[0] && setDraft({ ...draft, durationSec: v[0] })}
            />
          </Form.Item>
        </Form>
        <Button block color="primary" loading={busy} onClick={() => void save()}>
          保存
        </Button>
      </div>
    </Popup>
  );
}

export function StorylinesPage() {
  const { projectId = '' } = useParams();
  const navigate = useNavigate();
  const { data: view, isLoading } = useProject(projectId);
  const refresh = useRefreshProject(projectId);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<Line | null>(null);

  if (isLoading || !view) return <Loading />;

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
      await api.post(`/app/v1/projects/${projectId}/storylines`, { direction: direction.trim() });
      await refresh();
    } catch (err) {
      showError(err);
    } finally {
      setBusy(null);
    }
  };

  const select = async (line: Line) => {
    if (view.storyboard && !(await Dialog.confirm({ content: '重新选择会生成新的故事板（旧版本保留）。继续吗？' }))) return;
    setBusy(line.id);
    try {
      await api.post(`/app/v1/storylines/${line.id}/select`);
      await refresh();
      navigate(`/p/${projectId}/storyboard`);
    } catch (err) {
      showError(err);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="page">
      <PageHeader title="选择故事线" step={1} back={`/p/${projectId}/product`} />
      {view.storylines.length === 0 && <EmptyHint text="还没有故事线" />}
      {view.storylines.map((line) => (
        <div key={line.id} className={`storyline-card ${line.selected ? 'selected' : ''}`} data-testid="storyline-card">
          <div className="storyline-head">
            <span className="storyline-title">{line.content.title}</span>
            <Tag color="primary" fill="outline">
              {STORY_TYPES[line.content.type]}
            </Tag>
            <Tag>{line.content.durationSec} 秒</Tag>
          </div>
          <div className="muted">风格：{line.content.style}</div>
          <div className="hook">开场：{line.content.hook}</div>
          <ul className="segments">
            {line.content.segments.map((s, i) => (
              <li key={i}>
                <b>
                  {s.startSec}-{s.endSec}s
                </b>
                ：{s.content}
              </li>
            ))}
          </ul>
          <div className="row-gap">
            <Button size="small" onClick={() => setEditing(line)}>
              编辑
            </Button>
            <Button size="small" color="primary" loading={busy === line.id} disabled={Boolean(busy)} onClick={() => void select(line)} data-testid="select-storyline">
              {line.selected ? '重新生成故事板' : '用这条'}
            </Button>
          </div>
        </div>
      ))}
      <ChatBox projectId={projectId} page="storylines" onApplied={() => void refresh()} />
      <BottomBar>
        <Button block loading={busy === 'regenerate'} disabled={Boolean(busy)} onClick={() => void regenerate()}>
          换一换
        </Button>
        {view.storyboard && (
          <Button block color="primary" onClick={() => navigate(`/p/${projectId}/storyboard`)}>
            查看故事板
          </Button>
        )}
      </BottomBar>
      <EditPopup line={editing} onClose={() => setEditing(null)} onSaved={() => void refresh()} />
    </div>
  );
}
