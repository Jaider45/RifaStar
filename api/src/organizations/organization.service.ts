import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Errors } from '../common/errors';
import { normalizePhone } from '../common/phone';
import { IMAGE_TYPES, MB } from '../storage/file-type';
import { StorageProvider } from '../storage/storage.provider';
import { type UploadPolicy, UploadsService } from '../storage/uploads.service';
import { AuditService } from '../audit/audit.service';
import { DatabaseService } from '../database/database.service';
import type { OrgContext } from '../tenancy/org-context';
import type { UpdateOrganizationDto } from './organizations.dto';

const PUBLIC_FIELDS = {
  id: true,
  name: true,
  slug: true,
  supportWhatsapp: true,
  logoKey: true,
  defaultAccentColor: true,
  customDomain: true,
  customDomainVerifiedAt: true,
  timezone: true,
  status: true,
  trialEndsAt: true,
  createdAt: true,
} as const;

@Injectable()
export class OrganizationService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly uploads: UploadsService,
    private readonly storage: StorageProvider,
  ) {}

  async get(org: OrgContext) {
    const row = await this.db.tenantTx(org.id, (tx) => tx.organization.findUniqueOrThrow({ where: { id: org.id }, select: PUBLIC_FIELDS }));
    return { ...row, logoUrl: row.logoKey ? await this.storage.signedGetUrl(row.logoKey, 3600) : null };
  }

  async setCustomDomain(org: OrgContext, domain: string | null) {
    try {
      await this.db.tenantTx(org.id, async (tx) => {
        const before = await tx.organization.findUniqueOrThrow({ where: { id: org.id }, select: { customDomain: true } });
        await tx.organization.update({ where: { id: org.id }, data: { customDomain: domain, customDomainVerifiedAt: null } });
        await this.audit.record(tx, { action: 'organization.custom_domain', entityType: 'organization', entityId: org.id, before, after: { customDomain: domain } });
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw Errors.conflict('DOMAIN_TAKEN', 'Ese dominio ya está en uso.');
      }
      throw err;
    }
    return this.get(org);
  }

  private logoPolicy(orgId: string): UploadPolicy {
    return { prefix: `logos/${orgId}/`, allowed: IMAGE_TYPES, maxBytes: 2 * MB, label: 'el logo' };
  }

  logoUpload(org: OrgContext, contentType: string, size: number) {
    return this.uploads.presign(this.logoPolicy(org.id), contentType, size);
  }

  async logoConfirm(org: OrgContext, key: string) {
    const file = await this.uploads.verify(this.logoPolicy(org.id), key);
    const previous = await this.db.tenantTx(org.id, async (tx) => {
      const before = await tx.organization.findUniqueOrThrow({ where: { id: org.id }, select: { logoKey: true } });
      await tx.organization.update({ where: { id: org.id }, data: { logoKey: file.key } });
      await this.audit.record(tx, { action: 'organization.logo_update', entityType: 'organization', entityId: org.id });
      return before.logoKey;
    });
    if (previous && previous !== file.key) await this.storage.remove(previous).catch(() => undefined);
    return this.get(org);
  }

  update(org: OrgContext, dto: UpdateOrganizationDto) {
    const data = {
      ...dto,
      ...(dto.supportWhatsapp !== undefined && {
        supportWhatsapp: dto.supportWhatsapp === null ? null : normalizePhone(dto.supportWhatsapp),
      }),
    };
    return this.db.tenantTx(org.id, async (tx) => {
      const before = await tx.organization.findUniqueOrThrow({ where: { id: org.id }, select: PUBLIC_FIELDS });
      const after = await tx.organization.update({ where: { id: org.id }, data, select: PUBLIC_FIELDS });
      await this.audit.record(tx, {
        action: 'organization.update',
        entityType: 'organization',
        entityId: org.id,
        before: pick(before, Object.keys(data)),
        after: pick(after, Object.keys(data)),
      });
      return after;
    });
  }
}

function pick<T extends object>(obj: T, keys: string[]): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([k]) => keys.includes(k))) as Partial<T>;
}
