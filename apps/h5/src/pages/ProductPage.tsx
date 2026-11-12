import { ActionSheet, Dialog, Input, TextArea, Toast } from 'antd-mobile';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, showError } from '../api';
import { AssetImage, BottomBar, ChatBox, FlowPage, Loading, PageHeader, Section, UploadButton, uploadFiles, UploadHero } from '../components';
import { useProject, useRefreshProject } from '../hooks';
import type { AssetKind, AssetView, FactView, ProjectView } from '../types';
import { IconClose, IconEdit, IconSparkle, IconTrash } from '../ui/icons';
import { Btn, Field, IconButton, Pill, type Tone } from '../ui/kit';

const QUALITY: Record<string, { text: string; tone: Tone }> = {
  good: { text: '质量好', tone: 'success' },
  fair: { text: '可用', tone: 'warning' },
  poor: { text: '质量差', tone: 'danger' },
};

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

function AssetCard({ asset, view, onChanged }: { asset: AssetView; view: ProjectView; onChanged: () => void }) {
  const [sheet, setSheet] = useState(false);
  const face = faceLabel(asset, view);
  const replacement = asset.replacementAssetId ? view.assets.find((a) => a.id === asset.replacementAssetId) : undefined;

  const resolve = async (body: Record<string, unknown>) => {
    try {
      await api.post(`/app/v1/assets/${asset.id}/face`, body);
      onChanged();
    } catch (err) {
      showError(err);
    }
  };

  const actions = [
    ...(asset.kind === 'CHARACTER' && view.virtualPortraits.length
      ? view.virtualPortraits.map((p) => ({
          key: `vp-${p.id}`,
          text: `换成虚拟人像：${p.name}`,
          description: p.description,
          onClick: () => void resolve({ resolution: 'VIRTUAL_PORTRAIT', virtualPortraitId: p.id }),
        }))
      : []),
    ...(asset.kind === 'CHARACTER'
      ? [{ key: 'similar', text: 'AI 按照片风格生成相似人物', description: '只参考年龄、发型、穿着等风格，生成一个新的人', onClick: () => void resolve({ resolution: 'AI_SIMILAR' }) }]
      : []),
    { key: 'exclude', text: '这张图不用作参考', description: asset.kind === 'CHARACTER' ? '人物只靠文字描述' : '可以在故事板里让 AI 重新生成', onClick: () => void resolve({ resolution: 'EXCLUDED' }) },
  ];

  const remove = async () => {
    if (!(await Dialog.confirm({ content: '删除这张图片？' }))) return;
    try {
      await api.del(`/app/v1/assets/${asset.id}`);
      onChanged();
    } catch (err) {
      showError(err);
    }
  };

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
        {asset.viewRole && <Pill className="on-bg">{asset.viewRole}</Pill>}
        {quality && <Pill tone={quality.tone}>{quality.text}</Pill>}
        {asset.face === 'UNKNOWN' && !asset.quality && <Pill className="on-bg">检查中</Pill>}
      </div>
      {asset.quality?.issues?.length ? <div className="ui-tile__note is-warn">{asset.quality.issues.join('、')}</div> : null}
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
        actions={actions}
        extra="视频模型不接受直接上传的真人照片，请选择怎么处理"
        cancelText="取消"
        closeOnAction
        onClose={() => setSheet(false)}
      />
    </div>
  );
}

function FactRow({ fact, onChanged }: { fact: FactView; onChanged: () => void }) {
  const confirmed = fact.source === 'MERCHANT_CONFIRMED';
  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      onChanged();
    } catch (err) {
      showError(err);
    }
  };
  const edit = async () => {
    let text = fact.text;
    const ok = await Dialog.confirm({
      title: '修改卖点',
      content: <TextArea defaultValue={fact.text} onChange={(v) => (text = v)} autoSize maxLength={80} />,
    });
    if (ok && text.trim()) await act(() => api.patch(`/app/v1/facts/${fact.id}`, { text: text.trim() }));
  };
  return (
    <div className="ui-fact" data-testid={confirmed ? 'fact-confirmed' : 'fact-suggested'}>
      <div className="ui-fact__text">{fact.text}</div>
      <div className="ui-fact__foot">
        <Pill tone={confirmed ? 'success' : 'warning'}>{confirmed ? '已确认' : 'AI 建议'}</Pill>
        <span className="ui-spacer" />
        <IconButton label="修改卖点" size="sm" tone="surface" onClick={() => void edit()}>
          <IconEdit size={17} />
        </IconButton>
        <IconButton label="删除卖点" size="sm" tone="surface" onClick={() => void act(() => api.del(`/app/v1/facts/${fact.id}`))}>
          <IconTrash size={17} />
        </IconButton>
        {!confirmed && (
          <Btn size="sm" variant="primary" onClick={() => void act(() => api.patch(`/app/v1/facts/${fact.id}`, { confirm: true }))} data-testid="fact-confirm">
            确认
          </Btn>
        )}
      </div>
    </div>
  );
}

function AssetGrid({
  projectId,
  kind,
  addText,
  assets,
  view,
  onChanged,
}: {
  projectId: string;
  kind: AssetKind;
  addText: string;
  assets: AssetView[];
  view: ProjectView;
  onChanged: () => void;
}) {
  return (
    <div className="ui-tiles">
      {assets.map((a) => (
        <AssetCard key={a.id} asset={a} view={view} onChanged={onChanged} />
      ))}
      <UploadButton projectId={projectId} kind={kind} text={addText} variant="tile" onUploaded={onChanged} />
    </div>
  );
}

export function ProductPage() {
  const { projectId = '' } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { data: view, isLoading } = useProject(projectId);
  const refresh = useRefreshProject(projectId);
  const [form, setForm] = useState({ name: '', description: '', targetAudience: '' });
  const [newFact, setNewFact] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [next, setNext] = useState(false);
  const [heroBusy, setHeroBusy] = useState(false);
  const autoAnalyzed = useRef(false);

  useEffect(() => {
    if (view) setForm({ name: view.product.name, description: view.product.description, targetAudience: view.product.targetAudience });
  }, [view?.product.name, view?.product.description, view?.product.targetAudience]); // eslint-disable-line react-hooks/exhaustive-deps

  // 从发布表单进来（?analyze=1）：自动做一次素材理解，填好商品名称和卖点建议
  const wantAuto = params.get('analyze') === '1';
  const canAuto = Boolean(view && !view.product.analyzedAt && view.assets.some((a) => a.kind === 'PRODUCT' && a.origin === 'UPLOAD'));
  useEffect(() => {
    if (!wantAuto || !view || autoAnalyzed.current) return;
    autoAnalyzed.current = true;
    setParams({}, { replace: true });
    if (canAuto) void analyze();
  }, [wantAuto, view, canAuto]); // eslint-disable-line react-hooks/exhaustive-deps

  if (isLoading || !view) return <Loading />;
  const uploads = (kind: AssetKind) => view.assets.filter((a) => a.kind === kind && a.origin === 'UPLOAD');
  const dirty =
    form.name !== view.product.name || form.description !== view.product.description || form.targetAudience !== view.product.targetAudience;

  const save = async () => {
    setSaving(true);
    try {
      await api.patch(`/app/v1/projects/${projectId}/product`, form);
      await refresh();
      return true;
    } catch (err) {
      showError(err);
      return false;
    } finally {
      setSaving(false);
    }
  };

  const analyze = async () => {
    if (dirty && !(await save())) return;
    setAnalyzing(true);
    try {
      await api.post(`/app/v1/projects/${projectId}/analyze`);
      await refresh();
      Toast.show({ content: '素材理解完成，请确认 AI 建议的卖点' });
    } catch (err) {
      showError(err);
    } finally {
      setAnalyzing(false);
    }
  };

  const addFact = async () => {
    if (!newFact.trim()) return;
    try {
      await api.post(`/app/v1/projects/${projectId}/facts`, { text: newFact.trim() });
      setNewFact('');
      await refresh();
    } catch (err) {
      showError(err);
    }
  };

  const goNext = async () => {
    if (dirty && !(await save())) return;
    const unresolved = view.assets.some((a) => a.origin === 'UPLOAD' && a.face === 'DETECTED' && a.faceResolution === 'NONE');
    if (unresolved && !(await Dialog.confirm({ content: '有图片含真人脸还没处理，生成视频前需要处理。先继续吗？' }))) return;
    if (view.storylines.length) {
      navigate(`/p/${projectId}/storylines`);
      return;
    }
    setNext(true);
    try {
      await api.post(`/app/v1/projects/${projectId}/storylines`, {});
      await refresh();
      navigate(`/p/${projectId}/storylines`);
    } catch (err) {
      showError(err);
    } finally {
      setNext(false);
    }
  };

  const suggested = view.product.facts.filter((f) => f.source === 'AI_SUGGESTED');
  const confirmed = view.product.facts.filter((f) => f.source === 'MERCHANT_CONFIRMED');
  const onChanged = () => void refresh();
  const productImages = uploads('PRODUCT');
  const aiName = view.product.analysis?.productName;
  const nameTag = !form.name.trim() ? (
    <Pill className="on-bg">选填</Pill>
  ) : aiName && form.name === aiName ? (
    <Pill tone="ink">
      <IconSparkle size={10} />
      AI 填写
    </Pill>
  ) : null;
  const nameMissing = !form.name.trim();

  const uploadFirst = async (files: File[]) => {
    setHeroBusy(true);
    const done = await uploadFiles(projectId, 'PRODUCT', files);
    setHeroBusy(false);
    await refresh();
    if (done.length && !view.product.analyzedAt) await analyze();
  };

  return (
    <FlowPage bar>
      <PageHeader title={view.product.name || '新商品'} step={0} back="/" />

      <Section
        title="商品图"
        desc={productImages.length ? '纯色干净背景、无多余文字、商品占画面一半以上；多拍几个角度（正面、侧面、细节、包装内部）' : undefined}
      >
        {productImages.length ? (
          <AssetGrid projectId={projectId} kind="PRODUCT" addText="继续添加" assets={productImages} view={view} onChanged={onChanged} />
        ) : (
          <UploadHero busy={heroBusy} onFiles={(files) => void uploadFirst(files)} testId="upload-PRODUCT" />
        )}
      </Section>

      <Section
        title="商品信息"
        extra={
          dirty ? (
            <Btn size="sm" variant="primary" loading={saving} onClick={() => void save()}>
              保存
            </Btn>
          ) : undefined
        }
      >
        <Field
          label={
            <span className="ui-field__label-row">
              商品名称
              {nameTag}
            </span>
          }
          hint={nameMissing ? '不填也可以，AI 素材理解时会帮你填写' : '包含品类和核心特征，例如“灰色可拆洗猫窝”'}
        >
          <Input
            className="ui-input"
            placeholder="例如：灰色可拆洗猫窝"
            value={form.name}
            onChange={(v) => setForm({ ...form, name: v })}
            maxLength={60}
            data-testid="product-name"
          />
        </Field>
        <Field label="商品描述" hint="使用场景、具体参数、体感，例如“适合夏天的网面跑鞋，重量 180g”">
          <TextArea
            className="ui-input"
            value={form.description}
            onChange={(v) => setForm({ ...form, description: v })}
            autoSize={{ minRows: 2 }}
            maxLength={1000}
            data-testid="product-desc"
          />
        </Field>
        <Field label="目标受众" hint="年龄 + 身份 + 核心需求，例如“25-35 岁通勤女性，关注舒适”">
          <Input
            className="ui-input"
            value={form.targetAudience}
            onChange={(v) => setForm({ ...form, targetAudience: v })}
            maxLength={200}
            data-testid="product-audience"
          />
        </Field>
      </Section>

      <Section
        title="卖点"
        desc="只有“已确认”的卖点会出现在口播和字幕里。卖点越具体越好：功能 + 数据 + 场景"
        extra={
          <Btn size="sm" variant="secondary" icon={<IconSparkle size={14} />} loading={analyzing} onClick={() => void analyze()} data-testid="analyze">
            AI 素材理解
          </Btn>
        }
      >
        <div className="ui-stack">
          {[...suggested, ...confirmed].map((f) => (
            <FactRow key={f.id} fact={f} onChanged={onChanged} />
          ))}
          <div className="ui-inline-form">
            <Input
              className="ui-input"
              placeholder="添加卖点，如“鞋底加厚 2cm，久站不累”"
              value={newFact}
              onChange={setNewFact}
              onEnterPress={() => void addFact()}
              maxLength={80}
              data-testid="new-fact"
            />
            <Btn variant="secondary" disabled={!newFact.trim()} onClick={() => void addFact()} data-testid="add-fact">
              添加
            </Btn>
          </div>
        </div>
        {view.product.analysis && (view.product.analysis.missingInfo.length > 0 || view.product.analysis.suggestions.length > 0) && (
          <div className="ui-analysis">
            {view.product.analysis.missingInfo.length > 0 && (
              <div>
                <b>还缺：</b>
                {view.product.analysis.missingInfo.join('；')}
              </div>
            )}
            {view.product.analysis.suggestions.length > 0 && (
              <div>
                <b>建议：</b>
                {view.product.analysis.suggestions.join('；')}
              </div>
            )}
          </div>
        )}
      </Section>

      <Section
        title="人物和场景"
        desc={`可选。不上传时，AI 会在故事板里生成。真人照片需要换成${view.virtualPortraits.length ? '虚拟人像或 ' : ' '}AI 相似人物`}
      >
        <div className="ui-sub-title">人物图</div>
        <AssetGrid projectId={projectId} kind="CHARACTER" addText="上传人物图" assets={uploads('CHARACTER')} view={view} onChanged={onChanged} />
        <div className="ui-sub-title">场景图</div>
        <AssetGrid projectId={projectId} kind="SCENE" addText="上传场景图" assets={uploads('SCENE')} view={view} onChanged={onChanged} />
      </Section>

      <ChatBox projectId={projectId} page="product" onApplied={onChanged} />

      <BottomBar>
        <Btn
          block
          size="lg"
          variant="primary"
          loading={next || analyzing}
          disabled={productImages.length === 0 || confirmed.length === 0 || nameMissing}
          onClick={() => void goNext()}
          data-testid="to-storylines"
        >
          {productImages.length === 0
            ? '先添加商品图'
            : analyzing
              ? 'AI 正在理解商品'
              : confirmed.length === 0
                ? '请先确认至少一条卖点'
                : nameMissing
                  ? '请先填写商品名称'
                  : view.storylines.length
                    ? '查看故事线'
                    : '下一步：生成 4 条故事线'}
        </Btn>
      </BottomBar>
    </FlowPage>
  );
}
