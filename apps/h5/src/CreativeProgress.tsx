import { useEffect, useRef, useState } from 'react';
import type { CreativeProgress } from '@ai-creative/shared';
import { api } from './api';
import { IconCheck, IconSparkle } from './ui/icons';
import { Notice } from './ui/kit';

export function useCreativeProgress() {
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [events, setEvents] = useState<CreativeProgress[]>([]);
  const [startedAt, setStartedAt] = useState(0);
  const [error, setError] = useState('');
  const run = async (path: string, body: unknown) => {
    setEvents([]);
    setError('');
    setStartedAt(Date.now());
    try {
      await api.postStream(path, body, (progress) => { if (mounted.current) setEvents((items) => [...items, progress]); });
      return mounted.current;
    } catch (err) {
      if (!mounted.current) return false;
      setError(err instanceof Error ? err.message : '生成失败，请查看最新结果');
      throw err;
    }
  };
  return { events, startedAt, error, run };
}

export function CreativeWaiting({ kind, events, startedAt, durationSec, facts, title }: {
  kind: 'storylines' | 'storyboard'; events: CreativeProgress[]; startedAt: number;
  durationSec: number; facts: string[]; title?: string;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  const phase = events.at(-1)?.phase;
  const labels: Record<CreativeProgress['phase'], string> = {
    preparing: '正在整理已确认卖点和创作要求',
    generating: kind === 'storylines' ? '正在构思 4 条不同方向的故事线' : '正在编排分镜、口播和参考图方案',
    validating: kind === 'storylines' ? '正在校验故事线时长和卖点引用' : '正在校验镜头、口播和参考图引用',
    correcting: '正在修正未通过校验的内容',
    waiting: 'AI 服务繁忙，正在等待恢复',
    saving: kind === 'storylines' ? '正在保存这批故事线' : '正在保存故事板并安排参考图生成',
  };
  const completedLabels: Record<CreativeProgress['phase'], string> = {
    preparing: '已整理已确认卖点和创作要求', generating: '已收到本轮生成结果', validating: '已完成本轮内容校验',
    correcting: '已发起内容修正', waiting: '已结束本轮限流等待', saving: '已保存创作方案',
  };
  return (
    <section className="ui-creation ui-block" data-testid="creative-progress" aria-label="创作进展">
      <div className="ui-creation__eyebrow"><IconSparkle size={18} /> AI 创作中 <span>已等待 {seconds} 秒</span></div>
      <h2 className="ui-creation__title">{kind === 'storylines' ? '让商品有故事' : '把故事变成镜头'}</h2>
      <p className="ui-creation__intro">{durationSec} 秒 · {kind === 'storylines' ? '4 条创意方向' : '逐镜脚本与参考图方案'}</p>
      <div className="ui-ai-status" role="status" aria-live="polite"><span className="ui-spinner" aria-hidden="true" />{phase ? labels[phase] : '正在连接创作服务'}</div>
      {seconds >= 45 && <p className="ui-caption ui-mt">还在处理中，结果完成后会保存到项目，无需重复点击生成。</p>}
      <details className="ui-creation__details" open>
        <summary>查看生成进展</summary>
        <ol className="ui-creation__events" aria-label="已收到的生成阶段">
          {events.map((event, i) => <li key={i} className={i === events.length - 1 ? 'is-current' : ''}>
            {i === events.length - 1 ? <span className="ui-dot ui-dot--running" /> : <IconCheck size={14} />}
            <span>{i === events.length - 1 ? labels[event.phase] : completedLabels[event.phase]}{event.phase === 'correcting' && event.attempt ? `（第 ${event.attempt} 轮）` : ''}{i === events.length - 1 && event.phase === 'waiting' && event.retryAfterMs ? `，约 ${Math.ceil(event.retryAfterMs / 1000)} 秒后重试` : ''}</span>
          </li>)}
          {!events.length && <li>等待服务端确认请求</li>}
        </ol>
      </details>
      <details className="ui-creation__details">
        <summary>查看本次创作要求</summary>
        {title && <p>{title}</p>}
        <p className="ui-caption">{durationSec} 秒 · 只使用你已确认的 {facts.length} 条卖点</p>
        <ul>{facts.map((fact, i) => <li key={i}>{fact}</li>)}</ul>
      </details>
      <p className="ui-creation__note">方案通过校验后再展示。离开页面不会取消生成，可稍后返回查看结果。</p>
    </section>
  );
}

export function CreativeError({ message }: { message: string }) {
  return message ? <div className="ui-notice-wrap"><Notice tone="warning">{message}。已有方案保留，可先查看最新结果。</Notice></div> : null;
}
