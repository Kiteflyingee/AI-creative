import {
  allowedValues,
  NARRATION_HARD_LIMIT,
  NARRATION_SOFT_LIMIT,
  REFERENCE_KIND_LABELS,
  SHOT_EDITABLE_FIELDS,
  SHOT_FIELD_LABELS,
  STORY_DURATIONS,
  type Reference,
  type Shot,
  type StoryboardSpec,
} from '@ai-creative/shared';
import { Button, Dialog, Form, Popup, Selector, Tag, TextArea, Toast } from 'antd-mobile';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, showError } from '../api';
import { AssetImage, BottomBar, ChatBox, Loading, PageHeader, Section, UploadButton } from '../components';
import { useProject, useRefreshProject } from '../hooks';
import type { AssetKind, ProjectView } from '../types';

const KIND_TO_ASSET: Record<Reference['kind'], AssetKind> = { product: 'PRODUCT', character: 'CHARACTER', scene: 'SCENE' };

function ReferenceCard({ reference: r, view, projectId, onChanged }: { reference: Reference; view: ProjectView; projectId: string; onChanged: () => void }) {
  const asset = view.assets.find((a) => a.id === r.assetId);
  const [busy, setBusy] = useState(false);
  const regenerate = async () => {
    let instruction = '';
    const ok = await Dialog.confirm({
      title: r.kind === 'product' ? 'AI 重新生成商品图' : `AI 重新生成${REFERENCE_KIND_LABELS[r.kind]}图`,
      content: (
        <TextArea
          placeholder={r.kind === 'product' ? '例如：换成白色影棚背景 / 放在木桌上（商品本身保持不变）' : '可选：怎么改？例如“把客厅换成浴室”，留空则按原描述重新生成'}
          onChange={(v) => (instruction = v)}
          autoSize={{ minRows: 2 }}
          maxLength={200}
        />
      ),
      confirmText: '生成',
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api.post(`/app/v1/projects/${projectId}/references/${r.refId}/regenerate`, { instruction: instruction.trim() });
      onChanged();
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  };
  const replace = async (assetId: string) => {
    try {
      await api.post(`/app/v1/projects/${projectId}/references/${r.refId}/replace`, { assetId });
      onChanged();
    } catch (err) {
      showError(err);
    }
  };
  const faceProblem = asset?.origin === 'UPLOAD' && asset.face === 'DETECTED' && asset.faceResolution === 'NONE';
  const replacement = asset?.replacementAssetId ? view.assets.find((a) => a.id === asset.replacementAssetId) : undefined;
  return (
    <div className="ref-card" data-testid={`ref-${r.kind}`}>
      <AssetImage asset={replacement ?? asset} />
      <div className="ref-name">{r.name}</div>
      {r.originalAssetId && (
        <Tag color={asset?.comparison?.consistent === 'pass' ? 'success' : 'warning'} fill="outline">
          AI 修改过，请核对外观
        </Tag>
      )}
      {asset?.comparison && asset.comparison.consistent !== 'pass' && <div className="asset-issues">{asset.comparison.issues.join('；')}</div>}
      {faceProblem && <div className="face-warning">有真人脸，请在商品素材页处理</div>}
      {!asset && <div className="muted small">无图片，只用文字描述</div>}
      <div className="ref-actions">
        <Button size="mini" loading={busy} onClick={() => void regenerate()} data-testid="ref-regenerate">
          AI 重新生成
        </Button>
        <UploadButton projectId={projectId} kind={KIND_TO_ASSET[r.kind]} text="换成我的图" size="mini" multiple={false} onUploaded={(a) => void replace(a[0]!.id)} />
        {r.originalAssetId && (
          <Button size="mini" fill="none" onClick={() => void replace('original')}>
            换回原图
          </Button>
        )}
      </div>
    </div>
  );
}

function ShotEditor({
  shot,
  spec,
  rule,
  onClose,
  onSave,
}: {
  shot: Shot;
  spec: StoryboardSpec;
  rule: ProjectView['model']['duration'];
  onClose: () => void;
  onSave: (shot: Shot) => void;
}) {
  const [draft, setDraft] = useState<Shot>(shot);
  const durations = allowedValues(rule);
  const narrationLen = draft.narration.length;
  return (
    <Popup visible onMaskClick={onClose} bodyStyle={{ borderRadius: '12px 12px 0 0', maxHeight: '85vh', overflow: 'auto' }}>
      <div className="popup-body">
        <Form layout="vertical">
          <Form.Item label={`时长（${rule.allowed?.length ? durations.join('、') : `${rule.min}–${rule.max}`} 秒）`}>
            <Selector
              columns={6}
              options={durations.filter((d) => d <= 15 || d === draft.durationSec).map((d) => ({ label: `${d}s`, value: d }))}
              value={[draft.durationSec]}
              onChange={(v) => v[0] && setDraft({ ...draft, durationSec: v[0] })}
            />
          </Form.Item>
          {SHOT_EDITABLE_FIELDS.map((field) => (
            <Form.Item
              key={field}
              label={SHOT_FIELD_LABELS[field]}
              help={
                field === 'narration'
                  ? narrationLen > NARRATION_HARD_LIMIT
                    ? `已 ${narrationLen} 字，超过 ${NARRATION_HARD_LIMIT} 字模型很难说完`
                    : narrationLen > NARRATION_SOFT_LIMIT
                      ? `已 ${narrationLen} 字，${NARRATION_SOFT_LIMIT} 字以内最稳定`
                      : `${NARRATION_SOFT_LIMIT} 字以内最稳定`
                  : field === 'caption'
                    ? '合成时叠加在画面下方，之后还能改'
                    : undefined
              }
            >
              <TextArea value={draft[field]} onChange={(v) => setDraft({ ...draft, [field]: v })} autoSize maxLength={field === 'caption' ? 40 : 300} />
            </Form.Item>
          ))}
          <Form.Item label="参考图">
            <Selector
              multiple
              options={spec.references.map((r) => ({ label: `${REFERENCE_KIND_LABELS[r.kind]}·${r.name}`, value: r.refId }))}
              value={draft.refIds}
              onChange={(v) => setDraft({ ...draft, refIds: v.slice(0, 6) })}
            />
          </Form.Item>
        </Form>
        <Button block color="primary" disabled={narrationLen > NARRATION_HARD_LIMIT} onClick={() => onSave(draft)}>
          保存镜头
        </Button>
      </div>
    </Popup>
  );
}

export function StoryboardPage() {
  const { projectId = '' } = useParams();
  const navigate = useNavigate();
  const { data: view, isLoading } = useProject(projectId);
  const refresh = useRefreshProject(projectId);
  const [editing, setEditing] = useState<Shot | null>(null);
  const [busy, setBusy] = useState(false);

  if (isLoading || !view) return <Loading />;
  const board = view.storyboard;
  if (!board) {
    return (
      <div className="page">
        <PageHeader title="故事板" step={2} back={`/p/${projectId}/storylines`} />
        <div className="center-box">还没有故事板，请先选择一条故事线</div>
      </div>
    );
  }
  const spec = board.spec;

  const saveSpec = async (next: StoryboardSpec) => {
    setBusy(true);
    try {
      await api.patch(`/app/v1/projects/${projectId}/storyboard`, { expectedVersion: board.version, spec: next });
      await refresh();
      return true;
    } catch (err) {
      showError(err);
      await refresh();
      return false;
    } finally {
      setBusy(false);
    }
  };

  const updateShot = async (shot: Shot) => {
    if (await saveSpec({ ...spec, shots: spec.shots.map((s) => (s.shotId === shot.shotId ? shot : s)) })) setEditing(null);
  };
  const move = (index: number, delta: number) => {
    const shots = [...spec.shots];
    const [s] = shots.splice(index, 1);
    shots.splice(index + delta, 0, s!);
    void saveSpec({ ...spec, shots });
  };
  const remove = async (index: number) => {
    if (spec.shots.length <= 1) return Toast.show('至少保留一个镜头');
    if (!(await Dialog.confirm({ content: `删除镜头 ${index + 1}？` }))) return;
    void saveSpec({ ...spec, shots: spec.shots.filter((_, i) => i !== index) });
  };
  const add = () => {
    const shot: Shot = {
      shotId: `shot_${Date.now().toString(36)}`,
      purpose: '',
      durationSec: view.model.duration.recommended,
      subject: '',
      videoType: spec.shots[0]?.videoType ?? '',
      camera: '',
      action: '',
      scene: '',
      narration: '',
      caption: '',
      consistency: '',
      refIds: spec.shots[0]?.refIds ?? [],
    };
    setEditing(shot);
  };
  const saveEditing = async (shot: Shot) => {
    const exists = spec.shots.some((s) => s.shotId === shot.shotId);
    if (exists) await updateShot(shot);
    else if (await saveSpec({ ...spec, shots: [...spec.shots, shot] })) setEditing(null);
  };
  const setTotal = async (durationSec: number) => {
    setBusy(true);
    try {
      await api.post(`/app/v1/projects/${projectId}/storyboard/duration`, { durationSec, expectedVersion: board.version });
      await refresh();
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  };

  const refsOf = (shot: Shot) => spec.references.filter((r) => shot.refIds.includes(r.refId));
  const clipsOf = (shotId: string) => view.clips.filter((c) => c.shotId === shotId && c.status === 'SUCCEEDED');

  return (
    <div className="page">
      <PageHeader title="故事板" step={2} back={`/p/${projectId}/storylines`} />
      <Section title={`总时长 ${spec.durationSec} 秒 · ${spec.shots.length} 个镜头`}>
        <Selector
          options={STORY_DURATIONS.map((d) => ({ label: `${d} 秒`, value: d }))}
          value={STORY_DURATIONS.includes(spec.durationSec as 15) ? [spec.durationSec as 15] : []}
          onChange={(v) => v[0] && v[0] !== spec.durationSec && void setTotal(v[0])}
          disabled={busy}
        />
        <div className="muted small">风格：{spec.styleProfile || '—'} · 音色：{spec.voiceProfile || '—'}</div>
      </Section>

      <Section title="参考图（先锁定主体，再让画面动起来）">
        {(['product', 'character', 'scene'] as const).map((kind) => {
          const refs = spec.references.filter((r) => r.kind === kind);
          if (!refs.length) return null;
          return (
            <div key={kind}>
              <div className="sub-title">{REFERENCE_KIND_LABELS[kind]}</div>
              <div className="ref-row">
                {refs.map((r) => (
                  <ReferenceCard key={r.refId} reference={r} view={view} projectId={projectId} onChanged={() => void refresh()} />
                ))}
              </div>
            </div>
          );
        })}
      </Section>

      <Section title="分镜" extra={<Button size="small" onClick={add}>新增镜头</Button>}>
        {spec.shots.map((shot, i) => (
          <div key={shot.shotId} className="shot-card" data-testid="shot-card">
            <div className="shot-head">
              <b>镜头 {i + 1}</b>
              <Tag>{shot.durationSec} 秒</Tag>
              {shot.purpose && <Tag fill="outline">{shot.purpose}</Tag>}
              {clipsOf(shot.shotId).length > 0 && <Tag color="success">已生成 {clipsOf(shot.shotId).length} 版</Tag>}
            </div>
            <div className="shot-field">画面：{[shot.subject, shot.action, shot.scene].filter(Boolean).join('；') || '—'}</div>
            <div className="shot-field">运镜：{shot.camera || '—'}</div>
            <div className="shot-field">
              口播：{shot.narration || '无'}
              {shot.narration.length > NARRATION_SOFT_LIMIT && <Tag color="warning">口播偏长</Tag>}
            </div>
            <div className="shot-field">字幕：{shot.caption || '无'}</div>
            <div className="shot-refs">
              {refsOf(shot).map((r) => (
                <Tag key={r.refId} fill="outline">
                  {REFERENCE_KIND_LABELS[r.kind]}·{r.name}
                </Tag>
              ))}
            </div>
            <div className="row-gap">
              <Button size="mini" onClick={() => setEditing(shot)} data-testid="edit-shot">
                编辑
              </Button>
              <Button size="mini" disabled={i === 0 || busy} onClick={() => move(i, -1)}>
                上移
              </Button>
              <Button size="mini" disabled={i === spec.shots.length - 1 || busy} onClick={() => move(i, 1)}>
                下移
              </Button>
              <Button size="mini" fill="none" disabled={busy} onClick={() => void remove(i)}>
                删除
              </Button>
            </div>
          </div>
        ))}
      </Section>

      <ChatBox
        projectId={projectId}
        page="storyboard"
        onApplied={(r) => {
          void refresh();
          if (r.navigate?.page === 'storylines') navigate(`/p/${projectId}/storylines`);
        }}
      />

      <BottomBar>
        <Button block color="primary" size="large" disabled={busy} onClick={() => navigate(`/p/${projectId}/confirm`)} data-testid="to-confirm">
          去生成视频
        </Button>
      </BottomBar>

      {editing && <ShotEditor shot={editing} spec={spec} rule={view.model.duration} onClose={() => setEditing(null)} onSave={(s) => void saveEditing(s)} />}
    </div>
  );
}
