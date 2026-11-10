import '@fontsource/noto-sans-sc/700.css';
import { totalFrames, type CompositionInput } from '@ai-creative/shared';
import { Composition } from 'remotion';
import { AdVideo } from './AdVideo';

export const COMPOSITION_ID = 'AdVideo';

const defaultProps: CompositionInput = {
  fps: 24,
  width: 720,
  height: 1280,
  clips: [{ src: 'https://example.com/placeholder.mp4', durationInFrames: 24 }],
  captions: [],
};

export const RemotionRoot: React.FC = () => (
  <Composition
    id={COMPOSITION_ID}
    component={AdVideo}
    defaultProps={defaultProps}
    durationInFrames={24}
    fps={24}
    width={720}
    height={1280}
    calculateMetadata={({ props }) => ({
      durationInFrames: totalFrames(props),
      fps: props.fps,
      width: props.width,
      height: props.height,
    })}
  />
);
