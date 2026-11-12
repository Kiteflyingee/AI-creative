import { Dialog, SpinLoading, TextArea, Toast } from 'antd-mobile';
import { useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, showError } from './api';
import type { AssetKind, AssetView, ChatProposal } from './types';
import { IconBack, IconPlus, IconSparkle } from './ui/icons';
import { Btn, cx, IconButton, Sheet } from './ui/kit';

const STEPS = ['商品素材', '故事线', '故事板', '生成', '作品'];

/** 流程页顶栏：返回按钮 + 标题 + 五步进度（规范见 .kiro/steering/mobile-ui.md） */
export function PageHeader({ title, step, back = '/', extra }: { title: string; step?: number; back?: string; extra?: ReactNode }) {
  const navigate = useNavigate();
  return (
    <header className="ui-header">
      <div className="ui-header__row">
        <IconButton label="返回" onClick={() => navigate(back)}>
          <IconBack size={22} />
        </IconButton>
        <h1 className="ui-header__title">{title}</h1>
        {extra}
      </div>
      {step !== undefined && (
        <ol className="ui-steps-bar" aria-label={`第 ${step + 1} 步，共 ${STEPS.length} 步`}>
          {STEPS.map((s, i) => (
            <li key={s} className={cx(i < step && 'is-done', i === step && 'is-current')} aria-current={i === step ? 'step' : undefined}>
              <span className="ui-steps-bar__line" />
              <span className="ui-steps-bar__name">{s}</span>
            </li>
          ))}
        </ol>
      )}
    </header>
  );
}

/** 流程页骨架：有底部操作栏时传 bar，自动留出底部空间 */
export function FlowPage({ bar = false, children }: { bar?: boolean; children: ReactNode }) {
  return <div className={cx('ui-page', 'ui-page--flow', bar && 'has-bar')}>{children}</div>;
}

export function Loading({ text = '加载中', inline = false }: { text?: string; inline?: boolean }) {
  return (
    <div className={cx('ui-loading', inline && 'ui-loading--inline')}>
      <SpinLoading color="primary" style={{ '--size': '28px' } as React.CSSProperties} />
      <div>{text}</div>
    </div>
  );
}

/** 底部操作栏：悬浮在页面底部，内容滚到这里会淡出 */
export function BottomBar({ children }: { children: ReactNode }) {
  return <div className="ui-actionbar">{children}</div>;
}

export function Section({
  title,
  desc,
  extra,
  children,
}: {
  title: ReactNode;
  desc?: ReactNode;
  extra?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="ui-block">
      <div className="ui-block__head">
        <h2 className="ui-block__title">{title}</h2>
        {extra && <div className="ui-block__extra">{extra}</div>}
      </div>
      {desc && <p className="ui-block__desc">{desc}</p>}
      {children}
    </section>
  );
}

export function AiBadge() {
  return (
    <span className="ui-ai-badge">
      <IconSparkle size={10} />
      AI生成
    </span>
  );
}

export function EmptyHint({ text, children }: { text: string; children?: ReactNode }) {
  return (
    <div className="ui-empty">
      <div className="ui-caption">{text}</div>
      {children}
    </div>
  );
}

/** 选择本地图片并上传；失败时显示服务端给出的原因（如尺寸不符合要求）。tile 为图片网格里的“添加”块 */
export function UploadButton({
  projectId,
  kind,
  text,
  onUploaded,
  multiple = true,
  size = 'sm',
  variant = 'button',
}: {
  projectId: string;
  kind: AssetKind;
  text: string;
  onUploaded: (assets: AssetView[]) => void;
  multiple?: boolean;
  size?: 'xs' | 'sm';
  variant?: 'button' | 'tile';
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
      {variant === 'tile' ? (
        <button type="button" className="ui-tile ui-tile--add" disabled={busy} onClick={() => input.current?.click()}>
          <span className="ui-tile__media">
            <span className="ui-tile__plus">{busy ? <span className="ui-spinner" /> : <IconPlus size={18} />}</span>
            {busy ? '上传中' : text}
          </span>
        </button>
      ) : (
        <Btn size={size} variant="secondary" loading={busy} onClick={() => input.current?.click()}>
          {text}
        </Btn>
      )}
    </>
  );
}

/** 图片块的画面部分（ui-tile__media 内部） */
export function AssetImage({ asset, onClick }: { asset: AssetView | undefined; onClick?: () => void }) {
  if (!asset) return <span className="ui-tile__state">无图片</span>;
  if (asset.status === 'GENERATING')
    return (
      <span className="ui-tile__state">
        <SpinLoading color="primary" style={{ '--size': '20px' } as React.CSSProperties} />
        <span>AI 生成中</span>
      </span>
    );
  if (asset.status === 'FAILED') return <span className="ui-tile__state is-error">生成失败</span>;
  return <img src={asset.url ?? undefined} alt={asset.label} onClick={onClick} />;
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
    <section className="ui-block">
      <div className="ui-prompt">
        <div className="ui-prompt__label">
          <IconSparkle size={13} />
          用一句话修改
        </div>
        <TextArea
          placeholder={PAGE_HINT[page]}
          value={message}
          onChange={setMessage}
          autoSize={{ minRows: 2, maxRows: 5 }}
          maxLength={500}
          data-testid="chat-input"
        />
        <div className="ui-prompt__foot">
          <span className="ui-prompt__note">AI 先给出修改对比，你确认后才生效</span>
          <IconButton
            label="让 AI 修改"
            tone="ink"
            className="ui-prompt__send"
            disabled={busy || !message.trim()}
            onClick={() => void send()}
            data-testid="chat-send"
          >
            {busy ? <span className="ui-spinner" /> : <IconSparkle size={20} />}
          </IconButton>
        </div>
      </div>
      <Sheet
        visible={Boolean(proposal)}
        onClose={() => void discard()}
        testId="chat-proposal"
        footer={
          <>
            <Btn block size="lg" variant="secondary" onClick={() => void discard()}>
              不改了
            </Btn>
            <Btn block size="lg" variant="primary" loading={applying} onClick={() => void apply()} data-testid="chat-apply">
              应用
            </Btn>
          </>
        }
      >
        {proposal && (
          <>
            <div className="ui-sheet-reply">{proposal.reply}</div>
            {proposal.changes.map((c, i) => (
              <div key={i} className="ui-diff">
                <div className="ui-diff__title">{c.title}</div>
                {c.before !== undefined && <div className="ui-diff__before">原：{c.before || '（空）'}</div>}
                {c.after !== undefined && <div className="ui-diff__after">改为：{c.after || '（空）'}</div>}
              </div>
            ))}
          </>
        )}
      </Sheet>
    </section>
  );
}
