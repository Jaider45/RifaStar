import { Injectable } from '@nestjs/common';
import { normalizePhone } from '../common/phone';
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
  ) {}

  get(org: OrgContext) {
    return this.db.tenantTx(org.id, (tx) => tx.organization.findUniqueOrThrow({ where: { id: org.id }, select: PUBLIC_FIELDS }));
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
