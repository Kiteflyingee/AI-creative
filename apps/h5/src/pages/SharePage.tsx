import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { api } from '../api';
import { AiBadge, Loading } from '../components';

interface ShareView {
  title: string;
  durationSec: number | null;
  aiGenerated: boolean;
  videoUrl: string;
  coverUrl: string | null;
}

/** 公开分享页（D-29：页面显示“AI生成”） */
export function SharePage() {
  const { token = '' } = useParams();
  const share = useQuery({ queryKey: ['share', token], queryFn: () => api.get<ShareView>(`/app/v1/share/${token}`), retry: false });
  if (share.isLoading) return <Loading />;
  if (!share.data) return <div className="center-box">分享已失效</div>;
  return (
    <div className="share-page">
      <video className="output-video" src={share.data.videoUrl} poster={share.data.coverUrl ?? undefined} controls playsInline data-testid="share-video" />
      <div className="share-title">
        {share.data.title} <AiBadge />
      </div>
      <p className="muted small">本视频由 AI 生成。</p>
    </div>
  );
}
