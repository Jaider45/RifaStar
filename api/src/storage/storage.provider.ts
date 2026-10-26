import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { env } from '../config/env';

/**
 * Subida directa del navegador: `PUT url` con el archivo como cuerpo y estas cabeceras.
 * Se usa PUT (no el formulario POST) porque es lo que soportan todos los proveedores
 * compatibles con S3, incluido Cloudflare R2.
 */
export interface PresignedUpload {
  url: string;
  method: 'PUT';
  headers: Record<string, string>;
  key: string;
  expiresAt: string;
  maxBytes: number;
}

export interface UploadRequest {
  key: string;
  contentType: string;
  /** Tamaño exacto declarado por el cliente: queda dentro de la firma. */
  size: number;
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
  /** SHA-256 (hex) del objeto completo. */
  abstract sha256(key: string): Promise<string>;
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
        // Sin checksums automáticos: el SDK los agregaría a las URLs firmadas y el navegador
        // no los envía (R2 y SeaweedFS responden SignatureDoesNotMatch).
        requestChecksumCalculation: 'WHEN_REQUIRED',
        responseChecksumValidation: 'WHEN_REQUIRED',
      });
    this.internal = make(env().S3_ENDPOINT);
    this.publicClient = make(env().S3_PUBLIC_ENDPOINT ?? env().S3_ENDPOINT);
  }

  async presignUpload(req: UploadRequest): Promise<PresignedUpload> {
    // Content-Type y Content-Length van firmados: el almacenamiento rechaza otro tipo u otro
    // tamaño. Después de subir, UploadsService.verify revisa el tamaño y el tipo real.
    const command = new PutObjectCommand({ Bucket: this.bucket, Key: req.key, ContentType: req.contentType, ContentLength: req.size });
    const url = await getSignedUrl(this.publicClient, command, {
      expiresIn: req.expiresSeconds,
      signableHeaders: new Set(['content-type', 'content-length']),
    });
    return {
      url,
      method: 'PUT',
      headers: { 'Content-Type': req.contentType },
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

  async sha256(key: string): Promise<string> {
    const res = await this.internal.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    const hash = createHash('sha256');
    for await (const chunk of res.Body as AsyncIterable<Uint8Array>) hash.update(chunk);
    return hash.digest('hex');
  }

  async remove(key: string): Promise<void> {
    await this.internal.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

/** Tests y desarrollo sin almacenamiento: objetos en memoria. */
@Injectable()
export class FakeStorageProvider extends StorageProvider {
  readonly objects = new Map<string, Buffer>();
  readonly presigned: UploadRequest[] = [];

  async presignUpload(req: UploadRequest): Promise<PresignedUpload> {
    this.presigned.push(req);
    return {
      url: `https://almacenamiento.local/${encodeURIComponent(req.key)}`,
      method: 'PUT',
      headers: { 'Content-Type': req.contentType },
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

  async sha256(key: string): Promise<string> {
    return createHash('sha256').update(this.objects.get(key) ?? Buffer.alloc(0)).digest('hex');
  }

  async remove(key: string): Promise<void> {
    this.objects.delete(key);
  }

  /** Simula la subida directa del navegador. */
  put(key: string, body: Buffer): void {
    this.objects.set(key, body);
  }
}
