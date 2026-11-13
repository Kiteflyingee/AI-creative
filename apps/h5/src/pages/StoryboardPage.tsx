import {
  allowedValues,
  NARRATION_HARD_LIMIT,
  NARRATION_SOFT_LIMIT,
  REFERENCE_KIND_LABELS,
  SHOT_EDITABLE_FIELDS,
  SHOT_FIELD_LABELS,
  type Reference,
  type Shot,
  type StoryboardSpec,
} from '@ai-creative/shared';
import { Dialog, TextArea, Toast } from 'antd-mobile';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, showError } from '../api';
import { AssetImage, BottomBar, ChatBox, EmptyHint, FlowPage, Loading, PageHeader, Section, UploadButton } from '../components';
import { useProject, useRefreshProject } from '../hooks';
import type { AssetKind, ProjectView } from '../types';
import { IconArrowDown, IconArrowUp, IconPlus, IconSparkle, IconTrash } from '../ui/icons';
import { Btn, ChoiceGroup, Field, IconButton, Pill, Sheet } from '../ui/kit';

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
    <div className="ui-tile ui-ref" data-testid={`ref-${r.kind}`}>
      <div className="ui-tile__media">
        <AssetImage asset={replacement ?? asset} />
      </div>
      <div className="ui-ref__name">{r.name}</div>
      {r.originalAssetId && (
        <div className="ui-tile__meta">
          <Pill tone={asset?.comparison?.consistent === 'pass' ? 'success' : 'warning'}>AI 修改过，请核对外观</Pill>
        </div>
      )}
      {asset?.comparison && asset.comparison.consistent !== 'pass' && <div className="ui-tile__note is-warn">{asset.comparison.issues.join('；')}</div>}
      {faceProblem && <div className="ui-tile__note is-danger">有真人脸，请在商品素材页处理</div>}
      {!asset && <div className="ui-tile__note">无图片，只用文字描述</div>}
      <div className="ui-ref__actions">
        <Btn size="xs" variant="secondary" icon={<IconSparkle size={12} />} loading={busy} onClick={() => void regenerate()} data-testid="ref-regenerate">
          AI 重新生成
        </Btn>
        <UploadButton projectId={projectId} kind={KIND_TO_ASSET[r.kind]} text="换成我的图" size="xs" multiple={false} onUploaded={(a) => void replace(a[0]!.id)} />
        {r.originalAssetId && (
          <Btn size="xs" variant="ghost" onClick={() => void replace('original')}>
            换回原图
          </Btn>
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
    <Sheet
      visible
      onClose={onClose}
      title={spec.shots.some((s) => s.shotId === shot.shotId) ? '编辑镜头' : '新增镜头'}
      footer={
        <Btn block size="lg" variant="primary" disabled={narrationLen > NARRATION_HARD_LIMIT} onClick={() => onSave(draft)}>
          保存镜头
        </Btn>
      }
    >
      <Field label={`时长（${rule.allowed?.length ? durations.join('、') : `${rule.min}–${rule.max}`} 秒）`}>
        <ChoiceGroup
          label="镜头时长"
          size="sm"
          options={durations.filter((d) => d <= 15 || d === draft.durationSec).map((d) => ({ label: `${d}s`, value: d }))}
          value={[draft.durationSec]}
          onChange={(v) => v[0] && setDraft({ ...draft, durationSec: v[0] })}
        />
      </Field>
      {SHOT_EDITABLE_FIELDS.map((field) => (
        <Field
          key={field}
          label={SHOT_FIELD_LABELS[field]}
          hint={
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
          <TextArea
            className="ui-input"
            value={draft[field]}
            onChange={(v) => setDraft({ ...draft, [field]: v })}
            autoSize={{ minRows: 1, maxRows: 6 }}
            maxLength={field === 'caption' ? 40 : 300}
          />
        </Field>
      ))}
      <Field label="参考图" hint="最多 6 张">
        <ChoiceGroup
          label="参考图"
          size="sm"
          multiple
          options={spec.references.map((r) => ({ label: `${REFERENCE_KIND_LABELS[r.kind]}·${r.name}`, value: r.refId }))}
          value={draft.refIds}
          onChange={(v) => setDraft({ ...draft, refIds: v.slice(0, 6) })}
        />
      </Field>
    </Sheet>
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
      <FlowPage>
        <PageHeader title="故事板" step={2} back={`/p/${projectId}/storylines`} />
        <section className="ui-block">
          <EmptyHint text="还没有故事板，请先选择一条故事线">
            <Btn variant="primary" onClick={() => navigate(`/p/${projectId}/storylines`)}>
              去选故事线
            </Btn>
          </EmptyHint>
        </section>
      </FlowPage>
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

  const refsOf = (shot: Shot) => spec.references.filter((r) => shot.refIds.includes(r.refId));
  const clipsOf = (shotId: string) => view.clips.filter((c) => c.shotId === shotId && c.status === 'SUCCEEDED');

  return (
    <FlowPage bar>
      <PageHeader title="故事板" step={2} back={`/p/${projectId}/storylines`} />

      <section className="ui-block">
        <div className="ui-summary">
          <span className="ui-summary__big">{spec.durationSec} 秒</span>
          <span className="ui-summary__small">{spec.shots.length} 个镜头</span>
        </div>
        <p className="ui-block__desc ui-summary__desc">
          风格：{spec.styleProfile || '—'} · 音色：{spec.voiceProfile || '—'}
        </p>
        <Btn size="xs" variant="ghost" onClick={() => navigate(`/p/${projectId}/product`)} data-testid="replan-duration">调整时长并重新规划</Btn>
      </section>

      <Section title="参考图" desc="先锁定主体，再让画面动起来">
        {(['product', 'character', 'scene'] as const).map((kind) => {
          const refs = spec.references.filter((r) => r.kind === kind);
          if (!refs.length) return null;
          return (
            <div key={kind}>
              <div className="ui-sub-title">{REFERENCE_KIND_LABELS[kind]}</div>
              <div className="ui-hrail">
                {refs.map((r) => (
                  <ReferenceCard key={r.refId} reference={r} view={view} projectId={projectId} onChanged={() => void refresh()} />
                ))}
              </div>
            </div>
          );
        })}
      </Section>

      <Section
        title="分镜"
        extra={
          <Btn size="sm" variant="secondary" icon={<IconPlus size={14} />} onClick={add}>
            新增镜头
          </Btn>
        }
      >
        {spec.shots.map((shot, i) => (
          <article key={shot.shotId} className="ui-shot" data-testid="shot-card">
            <div className="ui-shot__head">
              <span className="ui-shot__no">镜头 {i + 1}</span>
              <Pill>{shot.durationSec} 秒</Pill>
              {shot.purpose && <Pill>{shot.purpose}</Pill>}
              {clipsOf(shot.shotId).length > 0 && <Pill tone="success">已生成 {clipsOf(shot.shotId).length} 版</Pill>}
            </div>
            <div className="ui-shot__fields">
              <div>
                <span className="k">画面：</span>
                {[shot.subject, shot.action, shot.scene].filter(Boolean).join('；') || '—'}
              </div>
              <div>
                <span className="k">运镜：</span>
                {shot.camera || '—'}
              </div>
              <div>
                <span className="k">口播：</span>
                {shot.narration || '无'}
                {shot.narration.length > NARRATION_SOFT_LIMIT && (
                  <>
                    {' '}
                    <Pill tone="warning">口播偏长</Pill>
                  </>
                )}
              </div>
              <div>
                <span className="k">字幕：</span>
                {shot.caption || '无'}
              </div>
            </div>
            {refsOf(shot).length > 0 && (
              <div className="ui-shot__refs">
                {refsOf(shot).map((r) => (
                  <Pill key={r.refId}>
                    {REFERENCE_KIND_LABELS[r.kind]}·{r.name}
                  </Pill>
                ))}
              </div>
            )}
            <div className="ui-shot__actions">
              <Btn size="sm" variant="surface" onClick={() => setEditing(shot)} data-testid="edit-shot">
                编辑
              </Btn>
              <span className="ui-spacer" />
              <IconButton label="上移" size="sm" tone="surface" disabled={i === 0 || busy} onClick={() => move(i, -1)}>
                <IconArrowUp size={17} />
              </IconButton>
              <IconButton label="下移" size="sm" tone="surface" disabled={i === spec.shots.length - 1 || busy} onClick={() => move(i, 1)}>
                <IconArrowDown size={17} />
              </IconButton>
              <IconButton label="删除" size="sm" tone="surface" disabled={busy} onClick={() => void remove(i)}>
                <IconTrash size={17} />
              </IconButton>
            </div>
          </article>
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
        <Btn
          block
          size="lg"
          variant="primary"
          icon={<IconSparkle size={16} />}
          disabled={busy}
          onClick={() => navigate(`/p/${projectId}/confirm`)}
          data-testid="to-confirm"
        >
          去生成视频
        </Btn>
      </BottomBar>

      {editing && <ShotEditor shot={editing} spec={spec} rule={view.model.duration} onClose={() => setEditing(null)} onSave={(s) => void saveEditing(s)} />}
    </FlowPage>
  );
}
