import { Logger } from '@nestjs/common';
import type { CompositionInput } from '@ai-creative/shared';
import type { Composer } from '../providers/types';

/** 与 packages/composition/src/Root.tsx 中的 COMPOSITION_ID 一致 */
const COMPOSITION_ID = 'AdVideo';

/**
 * Remotion 服务端渲染（D-21）：打包 packages/composition 一次，之后每次合成复用。
 * 首次渲染时 Remotion 会自动下载 Chrome Headless Shell（约 100MB）。
 */
export class RemotionComposer implements Composer {
  private readonly logger = new Logger(RemotionComposer.name);
  private serveUrl: Promise<string> | null = null;

  private async getServeUrl(): Promise<string> {
    if (!this.serveUrl) {
      this.serveUrl = (async () => {
        const { bundle } = await import('@remotion/bundler');
        const entryPoint = require.resolve('@ai-creative/composition/entry');
        this.logger.log(`打包 Remotion 合成组件：${entryPoint}`);
        return bundle({ entryPoint });
      })().catch((err) => {
        this.serveUrl = null;
        throw err;
      });
    }
    return this.serveUrl;
  }

  async render(input: CompositionInput, outFile: string): Promise<void> {
    const { renderMedia, selectComposition } = await import('@remotion/renderer');
    const serveUrl = await this.getServeUrl();
    const inputProps = input as unknown as Record<string, unknown>;
    const composition = await selectComposition({ serveUrl, id: COMPOSITION_ID, inputProps });
    await renderMedia({
      composition,
      serveUrl,
      codec: 'h264',
      audioCodec: 'aac',
      pixelFormat: 'yuv420p',
      crf: 18,
      outputLocation: outFile,
      inputProps,
      timeoutInMilliseconds: 180_000,
      logLevel: 'warn',
    });
  }
}
