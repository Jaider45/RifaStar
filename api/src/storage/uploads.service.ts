import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AppError, Errors } from '../common/errors';
import { type DetectedType, detectFileType, MB } from './file-type';
import { type PresignedUpload, StorageProvider } from './storage.provider';

export interface UploadPolicy {
  /** Prefijo obligatorio de la key (p. ej. receipts/{org}/{order}/). */
  prefix: string;
  allowed: ReadonlySet<DetectedType>;
  maxBytes: number;
  /** Texto para los mensajes de error: «el comprobante», «la foto de portada». */
  label: string;
}

const EXT: Record<DetectedType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'application/pdf': 'pdf',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
};

/**
 * Flujo de subida en dos pasos: URL firmada para subir directo al
 * almacenamiento y confirmación que valida tamaño y tipo real del archivo.
 */
@Injectable()
export class UploadsService {
  constructor(private readonly storage: StorageProvider) {}

  async presign(policy: UploadPolicy, contentType: string, size: number): Promise<PresignedUpload> {
    if (!policy.allowed.has(contentType as DetectedType)) throw this.invalidType(policy);
    if (size > policy.maxBytes) throw this.tooLarge(policy);
    const key = `${policy.prefix}${randomUUID()}.${EXT[contentType as DetectedType]}`;
    return this.storage.presignUpload({ key, contentType, maxBytes: policy.maxBytes, expiresSeconds: 300 });
  }

  /** Valida el archivo subido. Si no cumple, lo borra y responde con el error. */
  async verify(policy: UploadPolicy, key: string): Promise<{ key: string; mime: DetectedType; size: number }> {
    if (!key.startsWith(policy.prefix) || key.includes('..')) {
      throw Errors.validation({ field: 'key' }, 'El archivo no corresponde a esta solicitud.');
    }
    const size = await this.storage.size(key);
    if (size === null) throw new AppError('UPLOAD_NOT_FOUND', 422, `No encontramos ${policy.label}. Vuelve a subirlo.`);
    if (size > policy.maxBytes) {
      await this.storage.remove(key);
      throw this.tooLarge(policy);
    }
    const mime = detectFileType(await this.storage.head(key, 64));
    if (!mime || !policy.allowed.has(mime)) {
      await this.storage.remove(key);
      throw this.invalidType(policy);
    }
    return { key, mime, size };
  }

  private invalidType(policy: UploadPolicy) {
    const receipt = policy.allowed.has('application/pdf');
    return new AppError(
      receipt ? 'RECEIPT_INVALID_TYPE' : 'UPLOAD_INVALID_TYPE',
      422,
      receipt
        ? 'El comprobante debe ser una imagen (JPG, PNG, WEBP o HEIC) o un PDF.'
        : `El formato de ${policy.label} no es válido.`,
    );
  }

  private tooLarge(policy: UploadPolicy) {
    const receipt = policy.allowed.has('application/pdf');
    return new AppError(
      receipt ? 'RECEIPT_TOO_LARGE' : 'UPLOAD_TOO_LARGE',
      422,
      `${policy.label.charAt(0).toUpperCase()}${policy.label.slice(1)} supera el máximo de ${Math.round(policy.maxBytes / MB)} MB.`,
    );
  }
}
