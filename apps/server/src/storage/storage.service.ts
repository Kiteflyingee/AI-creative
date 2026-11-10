import { createReadStream, createWriteStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable } from '@nestjs/common';
import { getEnv } from '../config/env';

/**
 * 对象存储（S3 兼容）：本地 MinIO，生产阿里云 OSS（D-30）。
 * - internal 客户端：服务端读写，以及给本机 Remotion 渲染用的签名链接
 * - public 客户端：生成给浏览器访问的签名链接（真机调试时可配置为局域网地址）
 */
@Injectable()
export class StorageService {
  private readonly internal: S3Client;
  private readonly publicClient: S3Client;
  readonly bucket: string;

  constructor() {
    const env = getEnv();
    const base = {
      region: env.S3_REGION,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
      credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY },
    };
    this.internal = new S3Client({ ...base, endpoint: env.S3_ENDPOINT });
    this.publicClient = new S3Client({ ...base, endpoint: env.S3_PUBLIC_ENDPOINT || env.S3_ENDPOINT });
    this.bucket = env.S3_BUCKET;
  }

  async putBuffer(key: string, body: Buffer, contentType: string) {
    await this.internal.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
    );
  }

  async putFile(key: string, filePath: string, contentType: string) {
    const { size } = await stat(filePath);
    await this.internal.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: createReadStream(filePath),
        ContentType: contentType,
        ContentLength: size,
      }),
    );
  }

  async getBuffer(key: string): Promise<Buffer> {
    const res = await this.internal.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    const chunks: Buffer[] = [];
    for await (const chunk of res.Body as Readable) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
  }

  async downloadToFile(key: string, filePath: string) {
    const res = await this.internal.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    await pipeline(res.Body as Readable, createWriteStream(filePath));
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.internal.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }

  async delete(key: string) {
    await this.internal.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  /** 浏览器使用的签名下载链接 */
  publicUrl(key: string, expiresInSec = 3600, downloadName?: string): Promise<string> {
    return getSignedUrl(
      this.publicClient,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ResponseContentDisposition: downloadName
          ? `attachment; filename*=UTF-8''${encodeURIComponent(downloadName)}`
          : undefined,
      }),
      { expiresIn: expiresInSec },
    );
  }

  /** 服务端进程（Remotion 渲染）或公网模型可访问的签名链接 */
  internalUrl(key: string, expiresInSec = 3600): Promise<string> {
    return getSignedUrl(this.internal, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
      expiresIn: expiresInSec,
    });
  }
}
