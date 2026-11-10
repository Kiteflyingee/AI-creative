import { Button, Dialog, Empty, NavBar, Popup, SpinLoading, Steps, Tag, TextArea, Toast } from 'antd-mobile';
import { useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, showError } from './api';
import type { AssetKind, AssetView, ChatProposal } from './types';

const STEPS = ['商品素材', '故事线', '故事板', '生成', '作品'];

export function PageHeader({ title, step, back = '/' }: { title: string; step?: number; back?: string }) {
  const navigate = useNavigate();
  return (
    <div className="page-header">
      <NavBar onBack={() => navigate(back)}>{title}</NavBar>
      {step !== undefined && (
        <Steps current={step} style={{ '--title-font-size': '11px', '--icon-size': '16px' } as React.CSSProperties}>
          {STEPS.map((s) => (
            <Steps.Step key={s} title={s} />
          ))}
        </Steps>
      )}
    </div>
  );
}

export function Loading({ text = '加载中' }: { text?: string }) {
  return (
    <div className="center-box">
      <SpinLoading color="primary" />
      <div className="muted">{text}</div>
    </div>
  );
}

export function BottomBar({ children }: { children: ReactNode }) {
  return <div className="bottom-bar">{children}</div>;
}

export function Section({ title, extra, children }: { title: string; extra?: ReactNode; children: ReactNode }) {
  return (
    <section className="section">
      <div className="section-title">
        <span>{title}</span>
        {extra}
      </div>
      {children}
    </section>
  );
}

export function AiBadge() {
  return (
    <Tag color="primary" fill="outline" className="ai-badge">
      AI生成
    </Tag>
  );
}

export function EmptyHint({ text }: { text: string }) {
  return <Empty description={text} />;
}

/** 选择本地图片并上传；失败时显示服务端给出的原因（如尺寸不符合要求） */
export function UploadButton({
  projectId,
  kind,
  text,
  onUploaded,
  multiple = true,
  size = 'small',
}: {
  projectId: string;
  kind: AssetKind;
  text: string;
  onUploaded: (assets: AssetView[]) => void;
  multiple?: boolean;
  size?: 'mini' | 'small';
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    const done: AssetView[] = [];
    for (const file of Array.from(files)) {
      const form = new FormData();
      form.append('kind', kind);
      form.append('file', file);
      try {
        done.push(await api.upload<AssetView>(`/app/v1/projects/${projectId}/assets`, form));
      } catch (err) {
        Toast.show({ content: `${file.name}：${(err as Error).message}`, duration: 4000 });
      }
    }
    setBusy(false);
    if (input.current) input.current.value = '';
    if (done.length) onUploaded(done);
  };
  return (
    <>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple={multiple}
        hidden
        data-testid={`upload-${kind}`}
        onChange={(e) => void upload(e.target.files)}
      />
      <Button size={size} loading={busy} onClick={() => input.current?.click()}>
        {text}
      </Button>
    </>
  );
}

export function AssetImage({ asset, onClick }: { asset: AssetView | undefined; onClick?: () => void }) {
  if (!asset) return <div className="asset-img placeholder">无图片</div>;
  if (asset.status === 'GENERATING')
    return (
      <div className="asset-img placeholder">
        <SpinLoading style={{ '--size': '20px' } as React.CSSProperties} />
        <span>AI 生成中</span>
      </div>
    );
  if (asset.status === 'FAILED') return <div className="asset-img placeholder error">生成失败</div>;
  return <img className="asset-img" src={asset.url ?? undefined} alt={asset.label} onClick={onClick} />;
}

const PAGE_HINT: Record<string, string> = {
  product: '例如：把卖点改成“轻便透气，适合通勤穿”；目标受众改成 25-30 岁职场女性',
  storylines: '例如：这几条太常规了，想要先制造痛点再揭晓商品的反转剧情，15 秒',
  storyboard: '例如：第二个镜头太慢了，缩短到 4 秒，直接展示商品特写；把客厅换成浴室',
  work: '例如：第三个镜头商品变形了，重新生成；把第一个镜头的字幕改成“告别脚痛”',
};

/**
 * 对话修改（D-24）：说一句话 → AI 给出修改对比 → 点“应用”才生效。
 * 要调用视频模型的修改会跳转到生成确认页。
 */
export function ChatBox({
  projectId,
  page,
  onApplied,
}: {
  projectId: string;
  page: 'product' | 'storylines' | 'storyboard' | 'work';
  onApplied: (result: { navigate?: { page: string; shotIds?: string[] } }) => void;
}) {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [proposal, setProposal] = useState<ChatProposal | null>(null);
  const [applying, setApplying] = useState(false);

  const send = async () => {
    if (!message.trim()) return;
    setBusy(true);
    try {
      const p = await api.post<ChatProposal>(`/app/v1/projects/${projectId}/chat`, { page, message });
      if (p.changes.length === 0) {
        Dialog.alert({ content: p.clarification || p.reply || '没有需要修改的内容，请说得具体一些：改什么、改成什么样' });
      } else {
        setProposal(p);
      }
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    if (!proposal) return;
    setApplying(true);
    try {
      const result = await api.post<{ navigate?: { page: string; shotIds?: string[] } }>(`/app/v1/chat-edits/${proposal.id}/apply`);
      setProposal(null);
      setMessage('');
      Toast.show({ content: '已应用修改', icon: 'success' });
      onApplied(result);
    } catch (err) {
      showError(err);
    } finally {
      setApplying(false);
    }
  };

  const discard = async () => {
    if (proposal) await api.post(`/app/v1/chat-edits/${proposal.id}/discard`).catch(() => undefined);
    setProposal(null);
  };

  return (
    <div className="chat-box">
      <div className="chat-title">对话修改</div>
      <TextArea
        placeholder={PAGE_HINT[page]}
        value={message}
        onChange={setMessage}
        autoSize={{ minRows: 2, maxRows: 4 }}
        maxLength={500}
        data-testid="chat-input"
      />
      <Button size="small" color="primary" fill="outline" loading={busy} onClick={() => void send()} data-testid="chat-send">
        让 AI 修改
      </Button>
      <Popup visible={Boolean(proposal)} onMaskClick={() => void discard()} bodyStyle={{ borderRadius: '12px 12px 0 0', maxHeight: '75vh', overflow: 'auto' }}>
        {proposal && (
          <div className="proposal" data-testid="chat-proposal">
            <div className="proposal-reply">{proposal.reply}</div>
            {proposal.changes.map((c, i) => (
              <div key={i} className="change">
                <div className="change-title">{c.title}</div>
                {c.before !== undefined && <div className="change-before">原：{c.before || '（空）'}</div>}
                {c.after !== undefined && <div className="change-after">改为：{c.after || '（空）'}</div>}
              </div>
            ))}
            <div className="row-gap">
              <Button block onClick={() => void discard()}>
                不改了
              </Button>
              <Button block color="primary" loading={applying} onClick={() => void apply()} data-testid="chat-apply">
                应用
              </Button>
            </div>
          </div>
        )}
      </Popup>
    </div>
  );
}
