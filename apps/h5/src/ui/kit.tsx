/**
 * 基础组件（规范见 .kiro/steering/mobile-ui.md）。页面里的按钮、标签、表单项、选择块等统一从这里取，
 * 不直接使用 antd-mobile 的 Button / Tag / Selector / Checkbox / NoticeBar / ProgressBar / Steps / NavBar。
 * antd-mobile 只保留 Input、TextArea、Dialog、Popup、ActionSheet、Toast、SpinLoading，外观由 theme.css 统一。
 */
import { Popup } from 'antd-mobile';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { IconCheck } from './icons';

export function cx(...names: Array<string | false | null | undefined>): string {
  return names.filter(Boolean).join(' ');
}

type BtnVariant = 'primary' | 'secondary' | 'surface' | 'ghost' | 'danger';
type BtnSize = 'lg' | 'md' | 'sm' | 'xs';

interface BtnProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
  variant?: BtnVariant;
  size?: BtnSize;
  block?: boolean;
  loading?: boolean;
  icon?: ReactNode;
}

/** 按钮：主按钮黑色，次按钮浅灰；加载中自动禁用，避免重复提交 */
export function Btn({ variant = 'secondary', size = 'md', block, loading, icon, className, children, disabled, ...rest }: BtnProps) {
  return (
    <button
      type="button"
      className={cx('ui-btn', `ui-btn--${variant}`, size !== 'lg' && `ui-btn--${size}`, block && 'ui-btn--block', loading && 'is-loading', className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <span className="ui-spinner" aria-hidden="true" /> : icon}
      {children}
    </button>
  );
}

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
  label: string;
  size?: 'md' | 'sm';
  tone?: 'fill' | 'surface' | 'ink';
}

/** 只有图标的按钮：必须提供 label（读屏和自动化测试都用它） */
export function IconButton({ label, size = 'md', tone = 'fill', className, children, ...rest }: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cx('ui-icon-btn', size === 'sm' && 'ui-icon-btn--sm', tone !== 'fill' && `ui-icon-btn--${tone}`, className)}
      {...rest}
    >
      {children}
    </button>
  );
}

export type Tone = 'neutral' | 'ink' | 'success' | 'warning' | 'danger' | 'accent';

export function Pill({ tone = 'neutral', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={cx('ui-pill', `ui-pill--${tone}`, className)}>{children}</span>;
}

/** 表单项：标题 + 输入框 + 提示（提示直接显示，不藏在问号里） */
export function Field({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="ui-field">
      <div className="ui-field__label">{label}</div>
      {children}
      {hint && <div className="ui-field__hint">{hint}</div>}
    </div>
  );
}

export interface Choice<T extends string | number> {
  value: T;
  label: string;
  icon?: ReactNode;
}

/** 选择块（单选 / 多选），选中为黑底白字 */
export function ChoiceGroup<T extends string | number>({
  options,
  value,
  onChange,
  multiple = false,
  disabled = false,
  size = 'md',
  label,
  ...rest
}: {
  options: Choice<T>[];
  value: T[];
  onChange: (value: T[]) => void;
  multiple?: boolean;
  disabled?: boolean;
  size?: 'md' | 'sm';
  label: string;
  'data-testid'?: string;
}) {
  return (
    <div className="ui-choices" role={multiple ? 'group' : 'radiogroup'} aria-label={label} {...rest}>
      {options.map((o) => {
        const on = value.includes(o.value);
        return (
          <button
            key={String(o.value)}
            type="button"
            role={multiple ? 'checkbox' : 'radio'}
            aria-checked={on}
            className={cx('ui-choice', size === 'sm' && 'ui-choice--sm', on && 'is-on')}
            disabled={disabled}
            onClick={() => {
              if (multiple) onChange(on ? value.filter((v) => v !== o.value) : [...value, o.value]);
              else if (!on) onChange([o.value]);
            }}
          >
            {o.icon && <span className="ui-choice__icon">{o.icon}</span>}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** 勾选行（放在 ui-checklist 里） */
export function CheckRow({ checked, onChange, children }: { checked: boolean; onChange: (checked: boolean) => void; children: ReactNode }) {
  return (
    <button type="button" role="checkbox" aria-checked={checked} className="ui-check-row" onClick={() => onChange(!checked)}>
      <span className="ui-check" aria-hidden="true">
        {checked && <IconCheck size={14} />}
      </span>
      <span className="ui-check-row__body">{children}</span>
    </button>
  );
}

export function Notice({
  tone = 'neutral',
  icon,
  action,
  children,
}: {
  tone?: 'neutral' | 'warning' | 'danger';
  icon?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={cx('ui-notice', tone !== 'neutral' && `ui-notice--${tone}`)} role={tone === 'neutral' ? undefined : 'alert'}>
      {icon && <span className="ui-notice__icon">{icon}</span>}
      <div className="ui-notice__body">{children}</div>
      {action && <div className="ui-notice__action">{action}</div>}
    </div>
  );
}

/** 底部弹层：顶部大圆角 + 拖动条；footer 固定在弹层底部 */
export function Sheet({
  visible,
  onClose,
  title,
  footer,
  children,
  testId,
}: {
  visible: boolean;
  onClose: () => void;
  title?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <Popup visible={visible} onMaskClick={onClose} bodyClassName="ui-sheet" destroyOnClose>
      <div className="ui-sheet__inner" data-testid={testId}>
        <div className="ui-sheet__grabber" aria-hidden="true" />
        {title && <div className="ui-sheet__title">{title}</div>}
        {children}
        {footer && <div className="ui-sheet__footer">{footer}</div>}
      </div>
    </Popup>
  );
}
