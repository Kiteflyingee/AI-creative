import { ActionSheet, Dialog, Input, TextArea, Toast, type ActionSheetProps } from 'antd-mobile';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { STORY_DURATIONS, type StoryDuration } from '@ai-creative/shared';
import { api, showError } from '../api';
import { AssetImage, BottomBar, FlowPage, Loading, PageHeader, Section, UploadButton, uploadFiles, UploadHero } from '../components';
import { useProject, useRefreshProject } from '../hooks';
import { CreativeError, CreativeWaiting, useCreativeProgress } from '../CreativeProgress';
import type { AssetKind, AssetView, FactView, ProjectView } from '../types';
import { IconAlert, IconCheck, IconChevronRight, IconClock, IconClose, IconEdit, IconPlus, IconRefresh, IconSparkle } from '../ui/icons';
import { Btn, ChoiceGroup, cx, Field, IconButton, Notice, Pill, Sheet, type Tone } from '../ui/kit';

/**
 * 确认卖点页（发布流程第 3 步，D-56）：商家只需要点选至少 1 条卖点。
 * 商品名称由 AI 起，点一下可以改；描述、目标受众、人物图、场景图收进“更多（选填）”。
 */

const QUALITY: Record<string, { text: string; tone: Tone }> = {
  good: { text: '质量好', tone: 'success' },
  fair: { text: '可用', tone: 'warning' },
  poor: { text: '质量差', tone: 'danger' },
};

const needsFace = (a: AssetView) => a.origin === 'UPLOAD' && a.face === 'DETECTED' && a.faceResolution === 'NONE';

function faceLabel(a: AssetView, view: ProjectView): string | null {
  if (a.face !== 'DETECTED') return null;
  switch (a.faceResolution) {
    case 'NONE':
      return '有真人脸，需要处理';
    case 'VIRTUAL_PORTRAIT':
      return `已换成虚拟人像：${view.virtualPortraits.find((p) => p.id === a.virtualPortraitId)?.name ?? ''}`;
    case 'AI_SIMILAR':
      return '已换成 AI 相似人物';
    case 'EXCLUDED':
      return '不用作参考';
  }
}

function faceActions(asset: AssetView, view: ProjectView, resolve: (body: Record<string, unknown>) => void): ActionSheetProps['actions'] {
  return [
    ...(asset.kind === 'CHARACTER' && view.virtualPortraits.length
      ? view.virtualPortraits.map((p) => ({
          key: `vp-${p.id}`,
          text: `换成虚拟人像：${p.name}`,
          description: p.description,
          onClick: () => resolve({ resolution: 'VIRTUAL_PORTRAIT', virtualPortraitId: p.id }),
        }))
      : []),
    ...(asset.kind === 'CHARACTER'
      ? [{ key: 'similar', text: 'AI 按照片风格生成相似人物', description: '只参考年龄、发型、穿着等风格，生成一个新的人', onClick: () => resolve({ resolution: 'AI_SIMILAR' }) }]
      : []),
    {
      key: 'exclude',
      text: '这张图不用作参考',
      description: asset.kind === 'CHARACTER' ? '人物只靠文字描述' : '可以在故事板里让 AI 重新生成',
      onClick: () => resolve({ resolution: 'EXCLUDED' }),
    },
  ];
}

function useAssetActions(asset: AssetView, onChanged: () => void) {
  const resolve = async (body: Record<string, unknown>) => {
    try {
      await api.post(`/app/v1/assets/${asset.id}/face`, body);
      onChanged();
    } catch (err) {
      showError(err);
    }
  };
  const remove = async () => {
    if (!(await Dialog.confirm({ content: '删除这张图片？' }))) return;
    try {
      await api.del(`/app/v1/assets/${asset.id}`);
      onChanged();
    } catch (err) {
      showError(err);
    }
  };
  return { resolve, remove };
}

/** 人物图、场景图（在“更多”里）：保留完整的人脸处理 */
function AssetCard({ asset, view, onChanged }: { asset: AssetView; view: ProjectView; onChanged: () => void }) {
  const [sheet, setSheet] = useState(false);
  const { resolve, remove } = useAssetActions(asset, onChanged);
  const face = faceLabel(asset, view);
  const replacement = asset.replacementAssetId ? view.assets.find((a) => a.id === asset.replacementAssetId) : undefined;
  const quality = asset.quality?.level ? QUALITY[asset.quality.level] : undefined;
  const unresolved = asset.faceResolution === 'NONE';
  return (
    <div className="ui-tile" data-testid={`asset-${asset.kind}`}>
      <div className="ui-tile__media">
        <AssetImage asset={replacement ?? asset} />
        <button type="button" className="ui-tile__remove" aria-label="删除图片" onClick={() => void remove()}>
          <IconClose size={14} />
        </button>
      </div>
      <div className="ui-tile__meta">
        {quality && <Pill tone={quality.tone}>{quality.text}</Pill>}
        {asset.face === 'UNKNOWN' && !asset.quality && <Pill className="on-bg">检查中</Pill>}
      </div>
      {face && (
        <div className="ui-face">
          <div className={`ui-tile__note ${unresolved ? 'is-danger' : 'is-ok'}`}>{face}</div>
          <Btn size="xs" variant={unresolved ? 'primary' : 'secondary'} onClick={() => setSheet(true)} data-testid="face-resolve">
            {unresolved ? '处理' : '更改'}
          </Btn>
        </div>
      )}
      <ActionSheet
        visible={sheet}
        actions={faceActions(asset, view, (b) => void resolve(b))}
        extra="视频模型不接受直接上传的真人照片，请选择怎么处理"
        cancelText="取消"
        closeOnAction
        onClose={() => setSheet(false)}
      />
    </div>
  );
}

function AssetGrid({ projectId, kind, assets, view, onChanged }: { projectId: string; kind: AssetKind; assets: AssetView[]; view: ProjectView; onChanged: () => void }) {
  return (
    <div className="ui-tiles">
      {assets.map((a) => (
        <AssetCard key={a.id} asset={a} view={view} onChanged={onChanged} />
      ))}
      <UploadButton projectId={projectId} kind={kind} text="上传" variant="tile" onUploaded={onChanged} />
    </div>
  );
}

/** 顶部商品图缩略图：需要处理的图右上角有红点；点开看提示、处理或删除 */
function ProductThumb({ asset, index, view, onChanged }: { asset: AssetView; index: number; view: ProjectView; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const { resolve, remove } = useAssetActions(asset, onChanged);
  const face = needsFace(asset);
  const issues = asset.quality?.issues ?? [];
  const extra = face
    ? '这张图里有真人脸，视频模型不接受。可以不用它作参考，或者删除'
    : issues.length
      ? `这张图：${issues.join('、')}。换一张纯色背景的效果更好`
      : `第 ${index + 1} 张商品图`;
  const actions: ActionSheetProps['actions'] = [
    ...(face ? faceActions(asset, view, (b) => void resolve(b)) : []),
    { key: 'remove', text: '删除这张图', danger: true, onClick: () => void remove() },
  ];
  return (
    <>
      <button type="button" className="ui-thumb" aria-label={`第 ${index + 1} 张商品图`} onClick={() => setOpen(true)} data-testid="asset-PRODUCT">
        {asset.url && <img src={asset.url} alt="" />}
        {(face || asset.quality?.level === 'poor') && <span className="ui-thumb__flag" aria-hidden="true" />}
        {!face && asset.quality?.level === 'fair' && issues.length > 0 && <span className="ui-thumb__flag is-warn" aria-hidden="true" />}
      </button>
      <ActionSheet visible={open} actions={actions} extra={extra} cancelText="取消" closeOnAction onClose={() => setOpen(false)} />
    </>
  );
}

function ThumbAdd({ projectId, onUploaded }: { projectId: string; onUploaded: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        hidden
        data-testid="upload-PRODUCT"
        onChange={async (e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          if (!files.length) return;
          setBusy(true);
          await uploadFiles(projectId, 'PRODUCT', files);
          setBusy(false);
          onUploaded();
        }}
      />
      <button type="button" className="ui-thumb-add" aria-label="继续添加商品图" disabled={busy} onClick={() => input.current?.click()}>
        {busy ? <span className="ui-spinner" aria-hidden="true" /> : <IconPlus size={18} />}
      </button>
    </>
  );
}

const basisText = (f: FactView) =>
  f.origin === 'MERCHANT' ? '你写的' : f.basis.includes('图片') ? '依据：图片' : f.basis ? '依据：你的介绍' : 'AI 建议';

/** 卖点一行：点整行选中或取消，点铅笔修改 */
function PointRow({ fact, onToggle, onEdit, busy }: { fact: FactView; onToggle: () => void; onEdit: () => void; busy: boolean }) {
  const on = fact.source === 'MERCHANT_CONFIRMED';
  return (
    <div className="ui-point" data-testid={on ? 'fact-confirmed' : 'fact-suggested'}>
      <button
        type="button"
        role="checkbox"
        aria-checked={on}
        className="ui-check-row"
        disabled={busy}
        onClick={onToggle}
        data-testid={on ? 'fact-unconfirm' : 'fact-confirm'}
      >
        <span className="ui-check" aria-hidden="true">
          {on && <IconCheck size={14} />}
        </span>
        <span className="ui-check-row__body">
          {fact.text}
          <span className="ui-point__basis">{basisText(fact)}</span>
        </span>
      </button>
      <IconButton label="修改这条卖点" size="sm" tone="surface" onClick={onEdit} data-testid="fact-edit">
        <IconEdit size={17} />
      </IconButton>
    </div>
  );
}

type Editing = { mode: 'add' } | { mode: 'edit'; fact: FactView } | null;

function PointSheet({
  editing,
  onClose,
  onSave,
  onDelete,
}: {
  editing: Editing;
  onClose: () => void;
  onSave: (text: string) => Promise<void>;
  onDelete: (fact: FactView) => Promise<void>;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => setText(editing?.mode === 'edit' ? editing.fact.text : ''), [editing]);
  const own = editing?.mode === 'edit' && editing.fact.origin === 'MERCHANT';
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
      onClose();
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      visible={Boolean(editing)}
      onClose={onClose}
      title={editing?.mode === 'add' ? '自己加一条卖点' : '修改卖点'}
      testId="fact-sheet"
      footer={
        <>
          {own && editing?.mode === 'edit' && (
            <Btn size="lg" variant="secondary" disabled={busy} onClick={() => void run(() => onDelete(editing.fact))}>
              删除
            </Btn>
          )}
          <Btn block size="lg" variant="primary" loading={busy} disabled={!text.trim()} onClick={() => void run(() => onSave(text.trim()))} data-testid="fact-save">
            {editing?.mode === 'add' ? '添加' : '保存'}
          </Btn>
        </>
      }
    >
      <TextArea
        className="ui-input"
        placeholder="功能 + 数据 + 场景，例如“鞋底加厚 2cm，久站不累”"
        value={text}
        onChange={setText}
        autoSize={{ minRows: 2, maxRows: 4 }}
        maxLength={80}
        data-testid="fact-input"
      />
      <p className="ui-field__hint ui-mt-sm">保存后会自动选中，出现在口播和字幕里。只写商品真实具备的特点</p>
    </Sheet>
  );
}

export function ProductPage() {
  const { projectId = '' } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { data: view, isLoading } = useProject(projectId);
  const refresh = useRefreshProject(projectId);
  const [form, setForm] = useState({ description: '', targetAudience: '' });
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState('');
  const [next, setNext] = useState(false);
  const creation = useCreativeProgress();
  const [heroBusy, setHeroBusy] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [durationSec, setDurationSec] = useState<StoryDuration>(15);
  const autoAnalyzed = useRef(false);

  useEffect(() => {
    if (view) setForm({ description: view.product.description, targetAudience: view.product.targetAudience });
  }, [view?.product.description, view?.product.targetAudience]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (view) setDurationSec(view.project.targetDurationSec);
  }, [view?.project.targetDurationSec]); // eslint-disable-line react-hooks/exhaustive-deps

  const analyze = async () => {
    setAnalyzing(true);
    setAnalyzeError('');
    try {
      await api.post(`/app/v1/projects/${projectId}/analyze`);
      await refresh();
      return true;
    } catch (err) {
      setAnalyzeError(err instanceof Error ? err.message : '没能识别商品');
      return false;
    } finally {
      setAnalyzing(false);
    }
  };

  // 从发布表单进来（?analyze=1）：自动做一次素材理解，起名并提炼卖点
  const wantAuto = params.get('analyze') === '1';
  const canAuto = Boolean(view && !view.product.analyzedAt && view.assets.some((a) => a.kind === 'PRODUCT' && a.origin === 'UPLOAD'));
  useEffect(() => {
    if (!wantAuto || !view || autoAnalyzed.current) return;
    autoAnalyzed.current = true;
    setParams({}, { replace: true });
    if (canAuto) void analyze();
  }, [wantAuto, view, canAuto]); // eslint-disable-line react-hooks/exhaustive-deps

  // 人物图里有没处理的真人脸时自动展开“更多”
  const characterFace = Boolean(view?.assets.some((a) => a.kind !== 'PRODUCT' && needsFace(a)));
  useEffect(() => {
    if (characterFace) setMoreOpen(true);
  }, [characterFace]);

  if (isLoading || !view) return <Loading />;

  const uploads = (kind: AssetKind) => view.assets.filter((a) => a.kind === kind && a.origin === 'UPLOAD');
  const productImages = uploads('PRODUCT');
  const facts = view.product.facts;
  const selected = facts.filter((f) => f.source === 'MERCHANT_CONFIRMED');
  const name = view.product.name.trim();
  const aiName = view.product.analysis?.productName;
  const pending = analyzing && facts.length === 0;
  const dirty = form.description !== view.product.description || form.targetAudience !== view.product.targetAudience;
  const reuseStorylines = view.project.targetDurationSec === durationSec && view.storylines.length > 0 && view.storylines.every((line) => line.content.durationSec === durationSec);
  const anyFace = view.assets.some(needsFace);
  const onChanged = () => void refresh();

  const saveMore = async () => {
    if (!dirty) return true;
    try {
      await api.patch(`/app/v1/projects/${projectId}/product`, form);
      await refresh();
      return true;
    } catch (err) {
      showError(err);
      return false;
    }
  };

  const reanalyze = async () => {
    if (!(await saveMore())) return;
    if (await analyze()) Toast.show({ content: '已按新信息重新识别，选中的卖点都保留了' });
  };

  const uploadFirst = async (files: File[]) => {
    setHeroBusy(true);
    const done = await uploadFiles(projectId, 'PRODUCT', files);
    setHeroBusy(false);
    await refresh();
    if (done.length && !view.product.analyzedAt) await analyze();
  };

  const editName = async () => {
    let value = name;
    const ok = await Dialog.confirm({
      title: '商品名称',
      content: <Input defaultValue={name} placeholder="例如：灰色可拆洗猫窝" onChange={(v) => (value = v)} maxLength={60} data-testid="name-input" />,
      confirmText: '保存',
    });
    if (!ok || !value.trim() || value.trim() === name) return;
    try {
      await api.patch(`/app/v1/projects/${projectId}/product`, { name: value.trim() });
      await refresh();
    } catch (err) {
      showError(err);
    }
  };

  const toggle = async (fact: FactView) => {
    setToggling(fact.id);
    try {
      await api.patch(`/app/v1/facts/${fact.id}`, { confirm: fact.source !== 'MERCHANT_CONFIRMED' });
      await refresh();
    } catch (err) {
      showError(err);
    } finally {
      setToggling(null);
    }
  };

  const savePoint = async (text: string) => {
    if (editing?.mode === 'edit') {
      if (text !== editing.fact.text) await api.patch(`/app/v1/facts/${editing.fact.id}`, { text });
      else if (editing.fact.source !== 'MERCHANT_CONFIRMED') await api.patch(`/app/v1/facts/${editing.fact.id}`, { confirm: true });
    } else {
      await api.post(`/app/v1/projects/${projectId}/facts`, { text });
    }
    await refresh();
  };

  const deletePoint = async (fact: FactView) => {
    await api.del(`/app/v1/facts/${fact.id}`);
    await refresh();
  };

  const goNext = async () => {
    if (!(await saveMore())) return;
    if (anyFace && !(await Dialog.confirm({ content: '有图片含真人脸还没处理，生成视频前需要处理。先继续吗？' }))) return;
    if (reuseStorylines) {
      navigate(`/p/${projectId}/storylines`);
      return;
    }
    setNext(true);
    try {
      if (!(await creation.run(`/app/v1/projects/${projectId}/storylines/stream`, { durationSec }))) return;
      await refresh();
      navigate(`/p/${projectId}/storylines`);
    } catch {
      await refresh();
    } finally {
      setNext(false);
    }
  };

  if (next) return (
    <FlowPage bar>
      <PageHeader title="生成故事线" step={1} back="/" />
      <CreativeWaiting kind="storylines" events={creation.events} startedAt={creation.startedAt} durationSec={durationSec} facts={selected.map((f) => f.text)} />
      <BottomBar><Btn block size="lg" variant="primary" loading disabled>生成中</Btn></BottomBar>
    </FlowPage>
  );

  // 还没有商品图：只显示大上传区
  if (productImages.length === 0) {
    return (
      <FlowPage bar>
        <PageHeader title={name || '新商品'} step={0} back="/" />
        <Section title="商品图">
          <UploadHero busy={heroBusy} onFiles={(files) => void uploadFirst(files)} testId="upload-PRODUCT" />
        </Section>
        <BottomBar>
          <Btn block size="lg" variant="primary" disabled>
            先添加商品图
          </Btn>
        </BottomBar>
      </FlowPage>
    );
  }

  const buttonText = pending
    ? 'AI 正在看图'
    : !name && view.product.analyzedAt
      ? '请先填写商品名称'
      : selected.length === 0
        ? '至少选 1 条卖点'
        : reuseStorylines
          ? '查看故事线'
          : `${view.storylines.length ? '重新生成' : '生成'} 4 条 ${durationSec} 秒故事线`;

  return (
    <FlowPage bar>
      <PageHeader title={name || '新商品'} step={0} back="/" />

      <CreativeError message={creation.error} />

      {anyFace && (
        <div className="ui-notice-wrap">
          <Notice tone="danger" icon={<IconAlert size={16} />}>
            有图片含真人脸，视频模型不接受。{characterFace ? '请在下方“更多”里处理人物图' : '点带红点的商品图处理'}
          </Notice>
        </div>
      )}

      <section className="ui-block">
        <div className="ui-thumbs" aria-label="商品图">
          {productImages.map((a, i) => (
            <ProductThumb key={a.id} asset={a} index={i} view={view} onChanged={onChanged} />
          ))}
          <ThumbAdd projectId={projectId} onUploaded={onChanged} />
        </div>
      </section>

      {pending && (
        <section className="ui-block">
          <div className="ui-ai-status" role="status">
            <span className="ui-spinner" aria-hidden="true" />
            AI 正在看图，起名字、提炼卖点，大约 10 秒
          </div>
        </section>
      )}

      {analyzeError && !analyzing && (
        <div className="ui-notice-wrap">
          <Notice
            tone="warning"
            icon={<IconAlert size={16} />}
            action={
              <Btn size="xs" variant="surface" onClick={() => void analyze()}>
                重试
              </Btn>
            }
          >
            没能识别商品：{analyzeError}。也可以直接自己写卖点
          </Notice>
        </div>
      )}

      <section className="ui-block">
        <button type="button" className="ui-name-card" onClick={() => void editName()} disabled={pending} data-testid="product-name">
          <span className="ui-name-card__body">
            <span className="ui-name-card__label">商品名称</span>
            {pending ? (
              <span className="ui-skel ui-skel-line ui-skel-line--name" />
            ) : (
              <span className={cx('ui-name-card__value', !name && 'is-empty')} data-testid="product-name-value">
                {name || '点这里填写商品名称'}
              </span>
            )}
          </span>
          {name && aiName && name === aiName && (
            <Pill tone="ink">
              <IconSparkle size={10} />
              AI 填写
            </Pill>
          )}
          <span className="ui-icon-btn ui-icon-btn--sm ui-icon-btn--surface" aria-hidden="true">
            <IconEdit size={17} />
          </span>
        </button>
      </section>

      <Section title="选卖点" extra={!pending && <span className="ui-caption">已选 {selected.length} 条</span>}>
        <p className="ui-block__desc">选中的卖点会出现在口播和字幕里，至少选 1 条</p>
        <div className="ui-checklist">
          {pending
            ? [72, 86, 64].map((w) => (
                <div key={w} className="ui-skel-point">
                  <span className="ui-skel ui-skel-point__dot" />
                  <span className="ui-skel ui-skel-line" style={{ '--w': `${w}%` } as React.CSSProperties} />
                </div>
              ))
            : facts.map((f) => (
                <PointRow key={f.id} fact={f} busy={toggling === f.id} onToggle={() => void toggle(f)} onEdit={() => setEditing({ mode: 'edit', fact: f })} />
              ))}
          {!pending && (
            <button type="button" className="ui-point-add" onClick={() => setEditing({ mode: 'add' })} data-testid="add-fact">
              <span className="ui-point-add__icon">
                <IconPlus size={14} />
              </span>
              自己加一条
            </button>
          )}
        </div>
      </Section>

      <Section title="成片时长" desc="故事线、口播和镜头会按这个时长规划">
        <div data-testid="duration-choice">
          <ChoiceGroup
            label="成片时长"
            options={STORY_DURATIONS.map((d) => ({ label: `${d} 秒`, value: d, icon: <IconClock size={18} /> }))}
            value={[durationSec]}
            onChange={(value) => value[0] && setDurationSec(value[0])}
            disabled={next || pending}
          />
        </div>
        {view.storylines.length > 0 && !reuseStorylines && <p className="ui-caption ui-mt">继续后会按所选时长重新生成故事线，已有故事板和作品保留</p>}
      </Section>

      <section className="ui-block">
        <button type="button" className="ui-more" aria-expanded={moreOpen} onClick={() => setMoreOpen(!moreOpen)} data-testid="more-toggle">
          <span className="ui-more__body">
            <span className="ui-more__title">更多（选填）</span>
            <span className="ui-more__sub">{moreOpen ? '不填也能生成，填了 AI 会更贴合' : '商品描述、目标受众、人物图、场景图'}</span>
          </span>
          <span className="ui-more__chev">
            <IconChevronRight size={18} />
          </span>
        </button>

        {moreOpen && (
          <div className="ui-more-body">
            <Field label="商品描述" hint="使用场景、具体参数、体感">
              <TextArea
                className="ui-input"
                placeholder="例如：适合夏天的网面跑鞋，重量 180g"
                value={form.description}
                onChange={(v) => setForm({ ...form, description: v })}
                onBlur={() => void saveMore()}
                autoSize={{ minRows: 2 }}
                maxLength={1000}
                data-testid="product-desc"
              />
            </Field>
            <Field label="目标受众">
              <Input
                className="ui-input"
                placeholder="例如：25-35 岁养猫的上班族"
                value={form.targetAudience}
                onChange={(v) => setForm({ ...form, targetAudience: v })}
                onBlur={() => void saveMore()}
                maxLength={200}
                data-testid="product-audience"
              />
            </Field>
            <Field label="人物图" hint="不传时 AI 会在故事板里生成人物；真人照片需要换成 AI 相似人物">
              <AssetGrid projectId={projectId} kind="CHARACTER" assets={uploads('CHARACTER')} view={view} onChanged={onChanged} />
            </Field>
            <Field label="场景图" hint="不传时 AI 会在故事板里生成场景">
              <AssetGrid projectId={projectId} kind="SCENE" assets={uploads('SCENE')} view={view} onChanged={onChanged} />
            </Field>
            <Btn size="sm" variant="ghost" icon={<IconRefresh size={16} />} loading={analyzing} onClick={() => void reanalyze()} className="ui-mt" data-testid="analyze">
              按新信息重新识别卖点
            </Btn>
          </div>
        )}
      </section>

      <PointSheet editing={editing} onClose={() => setEditing(null)} onSave={savePoint} onDelete={deletePoint} />

      <BottomBar>
        <Btn
          block
          size="lg"
          variant="primary"
          loading={next}
          disabled={pending || !name || selected.length === 0}
          onClick={() => void goNext()}
          data-testid="to-storylines"
        >
          {buttonText}
        </Btn>
      </BottomBar>
    </FlowPage>
  );
}
