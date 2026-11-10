import sharp from 'sharp';
import type { ImageInputLimits } from '../providers/types';

export interface ImageMeta {
  format: string;
  mime: string;
  width: number;
  height: number;
  sizeBytes: number;
}

const MIME: Record<string, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  tiff: 'image/tiff',
  bmp: 'image/bmp',
};

/** 读取图片信息（按 EXIF 方向换算宽高） */
export async function readImageMeta(buffer: Buffer): Promise<ImageMeta | null> {
  try {
    const meta = await sharp(buffer).metadata();
    if (!meta.format || !meta.width || !meta.height) return null;
    const rotated = (meta.orientation ?? 1) >= 5;
    return {
      format: meta.format,
      mime: MIME[meta.format] ?? `image/${meta.format}`,
      width: rotated ? meta.height : meta.width,
      height: rotated ? meta.width : meta.height,
      sizeBytes: buffer.length,
    };
  } catch {
    return null;
  }
}

/** 按视频模型对参考图的要求校验；返回商家能看懂的原因，合格时返回 null */
export function checkImageAgainstLimits(meta: ImageMeta, limits: ImageInputLimits): string | null {
  // 上传只接受常见格式；模型支持的其他格式（bmp/tiff/gif）不在上传入口开放
  const uploadFormats = ['jpeg', 'png', 'webp'].filter((f) => limits.formats.includes(f));
  if (!uploadFormats.includes(meta.format)) return `不支持的图片格式（${meta.format}），请上传 JPG、PNG 或 WebP`;
  if (meta.sizeBytes >= limits.maxBytes) return `图片过大，请小于 ${Math.floor(limits.maxBytes / 1024 / 1024)}MB`;
  const short = Math.min(meta.width, meta.height);
  const long = Math.max(meta.width, meta.height);
  if (short < limits.minSide) return `图片太小（${meta.width}×${meta.height}），宽和高都至少需要 ${limits.minSide} 像素`;
  if (long > limits.maxSide) return `图片太大（${meta.width}×${meta.height}），宽和高都不能超过 ${limits.maxSide} 像素`;
  const ratio = meta.width / meta.height;
  if (ratio < limits.minRatio || ratio > limits.maxRatio) {
    return `图片太细长（宽高比 ${ratio.toFixed(2)}），宽高比需要在 ${limits.minRatio}–${limits.maxRatio} 之间`;
  }
  return null;
}

/** 转为 JPEG 并限制最长边（自动按 EXIF 旋转） */
export async function toJpeg(buffer: Buffer, maxSide: number, quality = 88): Promise<Buffer> {
  return sharp(buffer)
    .rotate()
    .resize({ width: maxSide, height: maxSide, fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality, mozjpeg: true })
    .toBuffer();
}

export const toDataUrl = (buffer: Buffer, mime = 'image/jpeg') => `data:${mime};base64,${buffer.toString('base64')}`;
