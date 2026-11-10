import type { CompositionInput } from '@ai-creative/shared';
import { AbsoluteFill, OffthreadVideo, Sequence, Series } from 'remotion';
import { Caption } from './Caption';

/** 成片：各镜头片段按顺序拼接，字幕按镜头时间段叠加 */
export const AdVideo: React.FC<CompositionInput> = ({ clips, captions, width, height }) => {
  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      <Series>
        {clips.map((clip, index) => (
          <Series.Sequence key={`${index}-${clip.src}`} durationInFrames={clip.durationInFrames}>
            <OffthreadVideo src={clip.src} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          </Series.Sequence>
        ))}
      </Series>
      {captions.map((caption, index) => (
        <Sequence
          key={`caption-${index}`}
          from={caption.fromFrame}
          durationInFrames={caption.durationInFrames}
          layout="none"
        >
          <Caption text={caption.text} width={width} height={height} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};
