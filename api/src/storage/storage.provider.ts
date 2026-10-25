import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable } from '@nestjs/common';
import { env } from '../config/env';

export interface PresignedUpload {
  url: string;
  fields: Record<string, string>;
  key: string;
  expiresAt: string;
  maxBytes: number;
}

export interface UploadRequest {
  key: string;
  contentType: string;
  maxBytes: number;
  expiresSeconds: number;
}

/** Almacenamiento privado compatible con S3: todo acceso es por URL firmada. */
export abstract class StorageProvider {
  abstract presignUpload(req: UploadRequest): Promise<PresignedUpload>;
  abstract signedGetUrl(key: string, expiresSeconds: number): Promise<string>;
  /** Tamaño en bytes o null si no existe. */
  abstract size(key: string): Promise<number | null>;
  /** Primeros `bytes` del objeto (para validar el tipo real). */
  abstract head(key: string, bytes: number): Promise<Buffer>;
  abstract remove(key: string): Promise<void>;
}

@Injectable()
export class S3StorageProvider extends StorageProvider {
  private readonly internal: S3Client;
  private readonly publicClient: S3Client;
  private readonly bucket = env().S3_BUCKET;

  constructor() {
    super();
    const make = (endpoint?: string) =>
      new S3Client({
        region: env().S3_REGION,
        endpoint,
        forcePathStyle: env().S3_FORCE_PATH_STYLE,
        credentials: env().S3_ACCESS_KEY ? { accessKeyId: env().S3_ACCESS_KEY, secretAccessKey: env().S3_SECRET_KEY } : undefined,
      });
    this.internal = make(env().S3_ENDPOINT);
    this.publicClient = make(env().S3_PUBLIC_ENDPOINT ?? env().S3_ENDPOINT);
  }

  async presignUpload(req: UploadRequest): Promise<PresignedUpload> {
    const { url, fields } = await createPresignedPost(this.publicClient, {
      Bucket: this.bucket,
      Key: req.key,
      Conditions: [
        ['content-length-range', 1, req.maxBytes],
        ['eq', '$Content-Type', req.contentType],
      ],
      Fields: { 'Content-Type': req.contentType },
      Expires: req.expiresSeconds,
    });
    return {
      url,
      fields,
      key: req.key,
      maxBytes: req.maxBytes,
      expiresAt: new Date(Date.now() + req.expiresSeconds * 1000).toISOString(),
    };
  }

  signedGetUrl(key: string, expiresSeconds: number): Promise<string> {
    return getSignedUrl(this.publicClient, new GetObjectCommand({ Bucket: this.bucket, Key: key }), { expiresIn: expiresSeconds });
  }

  async size(key: string): Promise<number | null> {
    try {
      const res = await this.internal.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return res.ContentLength ?? null;
    } catch {
      return null;
    }
  }

  async head(key: string, bytes: number): Promise<Buffer> {
    const res = await this.internal.send(new GetObjectCommand({ Bucket: this.bucket, Key: key, Range: `bytes=0-${bytes - 1}` }));
    return Buffer.from(await res.Body!.transformToByteArray());
  }

  async remove(key: string): Promise<void> {
    await this.internal.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

/** Desarrollo sin MinIO y tests: objetos en memoria. */
@Injectable()
export class FakeStorageProvider extends StorageProvider {
  readonly objects = new Map<string, Buffer>();

  async presignUpload(req: UploadRequest): Promise<PresignedUpload> {
    return {
      url: 'https://almacenamiento.local/subir',
      fields: { key: req.key, 'Content-Type': req.contentType },
      key: req.key,
      maxBytes: req.maxBytes,
      expiresAt: new Date(Date.now() + req.expiresSeconds * 1000).toISOString(),
    };
  }

  async signedGetUrl(key: string, expiresSeconds: number): Promise<string> {
    return `https://almacenamiento.local/${encodeURIComponent(key)}?expira=${expiresSeconds}`;
  }

  async size(key: string): Promise<number | null> {
    return this.objects.get(key)?.length ?? null;
  }

  async head(key: string, bytes: number): Promise<Buffer> {
    return (this.objects.get(key) ?? Buffer.alloc(0)).subarray(0, bytes);
  }

  async remove(key: string): Promise<void> {
    this.objects.delete(key);
  }

  /** Simula la subida directa del navegador. */
  put(key: string, body: Buffer): void {
    this.objects.set(key, body);
  }
}
