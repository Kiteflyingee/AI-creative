import { ActionSheet, Button, Dialog, Form, Input, Tag, TextArea, Toast } from 'antd-mobile';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, showError } from '../api';
import { AssetImage, BottomBar, ChatBox, Loading, PageHeader, Section, UploadButton } from '../components';
import { useProject, useRefreshProject } from '../hooks';
import type { AssetKind, AssetView, FactView, ProjectView } from '../types';

const QUALITY: Record<string, { text: string; color: string }> = {
  good: { text: '质量好', color: 'success' },
  fair: { text: '可用', color: 'warning' },
  poor: { text: '质量差', color: 'danger' },
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
  return (
    <div className="asset-card" data-testid={`asset-${asset.kind}`}>
      <AssetImage asset={replacement ?? asset} />
      <div className="asset-meta">
        {asset.viewRole && <Tag fill="outline">{asset.viewRole}</Tag>}
        {quality && <Tag color={quality.color}>{quality.text}</Tag>}
        {asset.face === 'UNKNOWN' && !asset.quality && <Tag>检查中</Tag>}
      </div>
      {asset.quality?.issues?.length ? <div className="asset-issues">{asset.quality.issues.join('、')}</div> : null}
      {face && (
        <div className={asset.faceResolution === 'NONE' ? 'face-warning' : 'face-ok'}>
          {face}
          <Button size="mini" color={asset.faceResolution === 'NONE' ? 'warning' : 'default'} onClick={() => setSheet(true)} data-testid="face-resolve">
            {asset.faceResolution === 'NONE' ? '处理' : '更改'}
          </Button>
        </div>
      )}
      <Button size="mini" fill="none" onClick={() => void remove()}>
        删除
      </Button>
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
    <div className={`fact ${confirmed ? 'confirmed' : 'suggested'}`} data-testid={confirmed ? 'fact-confirmed' : 'fact-suggested'}>
      <Tag color={confirmed ? 'success' : 'warning'} fill="outline">
        {confirmed ? '已确认' : 'AI 建议'}
      </Tag>
      <span className="fact-text">{fact.text}</span>
      <span className="fact-actions">
        {!confirmed && (
          <Button size="mini" color="primary" onClick={() => void act(() => api.patch(`/app/v1/facts/${fact.id}`, { confirm: true }))} data-testid="fact-confirm">
            确认
          </Button>
        )}
        <Button size="mini" onClick={() => void edit()}>
          改
        </Button>
        <Button size="mini" fill="none" onClick={() => void act(() => api.del(`/app/v1/facts/${fact.id}`))}>
          删
        </Button>
      </span>
    </div>
  );
}

export function ProductPage() {
  const { projectId = '' } = useParams();
  const navigate = useNavigate();
  const { data: view, isLoading } = useProject(projectId);
  const refresh = useRefreshProject(projectId);
  const [form, setForm] = useState({ name: '', description: '', targetAudience: '' });
  const [newFact, setNewFact] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [next, setNext] = useState(false);

  useEffect(() => {
    if (view) setForm({ name: view.product.name, description: view.product.description, targetAudience: view.product.targetAudience });
  }, [view?.product.name, view?.product.description, view?.product.targetAudience]); // eslint-disable-line react-hooks/exhaustive-deps

  if (isLoading || !view) return <Loading />;
  const uploads = (kind: AssetKind) => view.assets.filter((a) => a.kind === kind && a.origin === 'UPLOAD');
  const dirty =
    form.name !== view.product.name || form.description !== view.product.description || form.targetAudience !== view.product.targetAudience;

  const save = async () => {
    try {
      await api.patch(`/app/v1/projects/${projectId}/product`, form);
      await refresh();
      return true;
    } catch (err) {
      showError(err);
      return false;
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

  return (
    <div className="page">
      <PageHeader title="商品素材" step={0} />
      <Section title="商品信息">
        <Form layout="vertical">
          <Form.Item label="商品名称" help="包含品类和核心特征，例如“灰色可拆洗猫窝”">
            <Input value={form.name} onChange={(v) => setForm({ ...form, name: v })} maxLength={60} data-testid="product-name" />
          </Form.Item>
          <Form.Item label="商品描述" help="使用场景、具体参数、体感，例如“适合夏天的网面跑鞋，重量 180g”">
            <TextArea value={form.description} onChange={(v) => setForm({ ...form, description: v })} autoSize={{ minRows: 2 }} maxLength={1000} data-testid="product-desc" />
          </Form.Item>
          <Form.Item label="目标受众" help="年龄 + 身份 + 核心需求，例如“25-35 岁通勤女性，关注舒适”">
            <Input value={form.targetAudience} onChange={(v) => setForm({ ...form, targetAudience: v })} maxLength={200} data-testid="product-audience" />
          </Form.Item>
        </Form>
        {dirty && (
          <Button size="small" color="primary" onClick={() => void save()}>
            保存
          </Button>
        )}
      </Section>

      <Section
        title="商品图"
        extra={<UploadButton projectId={projectId} kind="PRODUCT" text="上传商品图" onUploaded={() => void refresh()} />}
      >
        <p className="hint">纯色干净背景、无多余文字、商品占画面一半以上；多拍几个角度（正面、侧面、细节、包装内部）</p>
        <div className="asset-grid">
          {uploads('PRODUCT').map((a) => (
            <AssetCard key={a.id} asset={a} view={view} onChanged={() => void refresh()} />
          ))}
        </div>
      </Section>

      <Section
        title="人物图（可选）"
        extra={<UploadButton projectId={projectId} kind="CHARACTER" text="上传人物图" onUploaded={() => void refresh()} />}
      >
        <p className="hint">不上传时，AI 会在故事板里生成人物。真人照片需要换成虚拟人像或 AI 相似人物</p>
        <div className="asset-grid">
          {uploads('CHARACTER').map((a) => (
            <AssetCard key={a.id} asset={a} view={view} onChanged={() => void refresh()} />
          ))}
        </div>
      </Section>

      <Section
        title="场景图（可选）"
        extra={<UploadButton projectId={projectId} kind="SCENE" text="上传场景图" onUploaded={() => void refresh()} />}
      >
        <div className="asset-grid">
          {uploads('SCENE').map((a) => (
            <AssetCard key={a.id} asset={a} view={view} onChanged={() => void refresh()} />
          ))}
        </div>
      </Section>

      <Section
        title="卖点"
        extra={
          <Button size="small" color="primary" fill="outline" loading={analyzing} onClick={() => void analyze()} data-testid="analyze">
            AI 素材理解
          </Button>
        }
      >
        <p className="hint">只有“已确认”的卖点会出现在口播和字幕里。卖点越具体越好：功能 + 数据 + 场景</p>
        {[...suggested, ...confirmed].map((f) => (
          <FactRow key={f.id} fact={f} onChanged={() => void refresh()} />
        ))}
        <div className="row-gap">
          <Input placeholder="添加卖点，如“鞋底加厚 2cm，久站不累”" value={newFact} onChange={setNewFact} maxLength={80} data-testid="new-fact" />
          <Button size="small" onClick={() => void addFact()} data-testid="add-fact">
            添加
          </Button>
        </div>
        {view.product.analysis && (
          <div className="analysis">
            {view.product.analysis.missingInfo.length > 0 && <div>还缺：{view.product.analysis.missingInfo.join('；')}</div>}
            {view.product.analysis.suggestions.length > 0 && <div>建议：{view.product.analysis.suggestions.join('；')}</div>}
          </div>
        )}
      </Section>

      <ChatBox projectId={projectId} page="product" onApplied={() => void refresh()} />

      <BottomBar>
        <Button block color="primary" size="large" loading={next} disabled={confirmed.length === 0 || uploads('PRODUCT').length === 0} onClick={() => void goNext()} data-testid="to-storylines">
          {confirmed.length === 0 ? '请先确认至少一条卖点' : view.storylines.length ? '查看故事线' : '下一步：生成 4 条故事线'}
        </Button>
      </BottomBar>
    </div>
  );
}
