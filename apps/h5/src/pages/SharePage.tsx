import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { api } from '../api';
import { AiBadge, EmptyHint, Loading } from '../components';
import { IconSparkle } from '../ui/icons';

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
  return (
    <div className="ui-share">
      <div className="ui-share__brand">
        <IconSparkle size={16} />
        AI 带货视频
      </div>
      {share.data ? (
        <>
          <div className="ui-player">
            <video src={share.data.videoUrl} poster={share.data.coverUrl ?? undefined} controls playsInline data-testid="share-video" />
          </div>
          <div className="ui-share__title">
            {share.data.title} <AiBadge />
          </div>
          <p className="ui-share__note">本视频由 AI 生成。</p>
        </>
      ) : (
        <EmptyHint text="分享已失效" />
      )}
    </div>
  );
}
