import { useEffect, useState } from 'react';
import { continueRender, delayRender } from 'remotion';

export const CAPTION_FONT_FAMILY = '"Noto Sans SC", "PingFang SC", "Hiragino Sans GB", sans-serif';

/**
 * 字幕：放在画面下方安全区内（距底部约 18%），白字加描边与半透明底，保证在任何画面上都清晰。
 * 渲染前等待字体加载完成，避免首帧使用回退字体。
 */
export const Caption: React.FC<{ text: string; width: number; height: number }> = ({ text, width, height }) => {
  const fontSize = Math.round(width * 0.058);
  const [handle] = useState(() => delayRender(`等待字幕字体：${text}`));

  useEffect(() => {
    let done = false;
    const finish = () => {
      if (!done) {
        done = true;
        continueRender(handle);
      }
    };
    const fonts = typeof document !== 'undefined' ? document.fonts : undefined;
    if (!fonts) {
      finish();
      return;
    }
    fonts
      .load(`700 ${fontSize}px "Noto Sans SC"`, text)
      .then(() => fonts.ready)
      .then(finish, finish);
    const timer = setTimeout(finish, 15000);
    return () => clearTimeout(timer);
  }, [handle, fontSize, text]);

  return (
    <div
      style={{
        position: 'absolute',
        left: width * 0.08,
        right: width * 0.08,
        bottom: height * 0.18,
        display: 'flex',
        justifyContent: 'center',
      }}
    >
      <span
        style={{
          fontFamily: CAPTION_FONT_FAMILY,
          fontWeight: 700,
          fontSize,
          lineHeight: 1.35,
          color: '#ffffff',
          textAlign: 'center',
          padding: `${fontSize * 0.18}px ${fontSize * 0.45}px`,
          borderRadius: fontSize * 0.3,
          backgroundColor: 'rgba(0, 0, 0, 0.38)',
          WebkitTextStroke: `${Math.max(1, Math.round(fontSize * 0.04))}px rgba(0,0,0,0.65)`,
          paintOrder: 'stroke fill',
          wordBreak: 'break-all',
        }}
      >
        {text}
      </span>
    </div>
  );
};
