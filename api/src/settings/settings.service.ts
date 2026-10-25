import { Injectable } from '@nestjs/common';
import { Prisma, type SettingsSection } from '@prisma/client';
import { Errors } from '../common/errors';
import { AuditService } from '../audit/audit.service';
import { DatabaseService, type Tx } from '../database/database.service';
import type { OrgContext } from '../tenancy/org-context';
import {
  CURRENT_SETTINGS_VERSION,
  defaultSettings,
  SETTINGS_SCHEMAS,
  SETTINGS_SECTIONS,
  type SettingsBySection,
  upgradeSettings,
} from './schemas';

export interface SettingsValue<S extends SettingsSection> {
  section: S;
  revision: number;
  data: SettingsBySection[S];
}

@Injectable()
export class SettingsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  /** Lee una sección dentro de una transacción del tenant (con valores por defecto si no existe). */
  async read<S extends SettingsSection>(tx: Tx, section: S): Promise<SettingsValue<S>> {
    const row = await tx.orgSettings.findFirst({ where: { section } });
    if (!row) return { section, revision: 0, data: defaultSettings(section) };
    return { section, revision: row.revision, data: upgradeSettings(section, row.schemaVersion, row.data) };
  }

  get<S extends SettingsSection>(org: OrgContext, section: S) {
    return this.db.tenantTx(org.id, (tx) => this.read(tx, section));
  }

  getAll(org: OrgContext) {
    return this.db.tenantTx(org.id, async (tx) => {
      const entries = await Promise.all(SETTINGS_SECTIONS.map((s) => this.read(tx, s)));
      return Object.fromEntries(entries.map((e) => [e.section, { revision: e.revision, data: e.data }]));
    });
  }

  /**
   * Reemplaza la sección completa. `revision` debe coincidir con la guardada
   * (control de concurrencia optimista).
   */
  update<S extends SettingsSection>(org: OrgContext, section: S, revision: number, input: unknown) {
    const parsed = SETTINGS_SCHEMAS[section].safeParse(input);
    if (!parsed.success) {
      throw Errors.validation(parsed.error.issues.map((i) => ({ path: ['data', ...i.path], message: i.message })));
    }
    const data = parsed.data as Prisma.InputJsonValue;
    return this.db.tenantTx(org.id, async (tx) => {
      const before = await this.read(tx, section);
      if (before.revision !== revision) throw Errors.revisionConflict({ currentRevision: before.revision });
      if (before.revision === 0) {
        await tx.orgSettings.create({
          data: { organizationId: org.id, section, schemaVersion: CURRENT_SETTINGS_VERSION[section], data, updatedById: org.memberId },
        });
      } else {
        const res = await tx.orgSettings.updateMany({
          where: { section, revision },
          data: { data, schemaVersion: CURRENT_SETTINGS_VERSION[section], revision: { increment: 1 }, updatedById: org.memberId },
        });
        if (res.count !== 1) throw Errors.revisionConflict();
      }
      await this.audit.record(tx, {
        action: 'settings.update',
        entityType: 'org_settings',
        entityId: section,
        before: before.data,
        after: data,
      });
      return { section, revision: before.revision + 1, data: parsed.data as SettingsBySection[S] };
    });
  }
}
