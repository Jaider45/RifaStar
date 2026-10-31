import { Injectable } from '@nestjs/common';
import type { GatewayAccount } from '@prisma/client';
import { AppError, Errors } from '../common/errors';
import { decrypt, encrypt } from '../common/crypto';
import { apiPublicUrl, env, wompiDriver } from '../config/env';
import { AuditService } from '../audit/audit.service';
import { DatabaseService } from '../database/database.service';
import type { OrgContext } from '../tenancy/org-context';
import type { ConnectGatewayDto, UpdateGatewayDto } from './payments.dto';
import { keysEnvironment } from './wompi/signatures';
import { WOMPI_METHODS, type WompiCredentials } from './wompi/types';
import { WompiClient } from './wompi/wompi.client';

/** «prv_test_abcdef123456» → «prv_test_••••3456»: lo único que se muestra de una llave privada. */
const hint = (value: string) => `${value.replace(/[^_]+$/, '').slice(0, 12)}••••${value.slice(-4)}`;

/**
 * Cuenta de Wompi de cada organización: el dinero de las boletas llega directo a la cuenta del
 * organizador. Las llaves privadas se guardan cifradas (AES-256-GCM) y nunca se devuelven.
 */
@Injectable()
export class GatewayAccountsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly wompi: WompiClient,
  ) {}

  webhookUrl(accountId: string): string {
    return `${apiPublicUrl()}/v1/webhooks/wompi/${accountId}`;
  }

  private present(a: GatewayAccount | null) {
    if (!a) {
      return { configured: false as const, supportedMethods: [...WOMPI_METHODS], simulated: wompiDriver() === 'fake' };
    }
    return {
      configured: true as const,
      id: a.id,
      environment: a.environment,
      publicKey: a.publicKey,
      privateKeyHint: hint(decrypt(a.privateKeyEnc)),
      methods: a.methods,
      isActive: a.isActive,
      verifiedAt: a.verifiedAt,
      lastEventAt: a.lastEventAt,
      webhookUrl: this.webhookUrl(a.id),
      supportedMethods: [...WOMPI_METHODS],
      simulated: wompiDriver() === 'fake',
    };
  }

  async get(org: OrgContext) {
    return this.present(await this.db.tenantTx(org.id, (tx) => tx.gatewayAccount.findFirst({ where: { provider: 'wompi' } })));
  }

  /**
   * Conecta las llaves. Se validan antes de guardar: prefijos coherentes (todas de pruebas o todas
   * de producción) y que Wompi reconozca la llave pública y la privada.
   */
  async connect(org: OrgContext, dto: ConnectGatewayDto) {
    const keys = { publicKey: dto.publicKey, privateKey: dto.privateKey, integritySecret: dto.integritySecret, eventsSecret: dto.eventsSecret };
    const detected = keysEnvironment(keys);
    if ('error' in detected) throw Errors.validation({ field: detected.field }, detected.error);
    const creds: WompiCredentials = { ...keys, environment: detected.environment };
    await this.wompi.merchant(creds.environment, creds.publicKey);
    await this.wompi.verifyPrivateKey(creds);

    const saved = await this.db.tenantTx(org.id, async (tx) => {
      const before = await tx.gatewayAccount.findFirst({ where: { provider: 'wompi' } });
      const data = {
        environment: creds.environment,
        publicKey: creds.publicKey,
        privateKeyEnc: encrypt(creds.privateKey),
        integritySecretEnc: encrypt(creds.integritySecret),
        eventsSecretEnc: encrypt(creds.eventsSecret),
        methods: dto.methods,
        isActive: true,
        verifiedAt: new Date(),
      };
      const account = before
        ? await tx.gatewayAccount.update({ where: { id: before.id }, data })
        : await tx.gatewayAccount.create({ data: { ...data, provider: 'wompi' } as never });
      await this.audit.record(tx, {
        action: before ? 'gateway.reconnect' : 'gateway.connect',
        entityType: 'gateway_account',
        entityId: account.id,
        before: before && { environment: before.environment, methods: before.methods },
        after: { environment: account.environment, methods: account.methods, publicKey: account.publicKey },
      });
      return account;
    });
    return this.present(saved);
  }

  async update(org: OrgContext, dto: UpdateGatewayDto) {
    const saved = await this.db.tenantTx(org.id, async (tx) => {
      const before = await tx.gatewayAccount.findFirst({ where: { provider: 'wompi' } });
      if (!before) throw Errors.conflict('GATEWAY_NOT_CONFIGURED', 'Primero conecta tu cuenta de Wompi.');
      const account = await tx.gatewayAccount.update({
        where: { id: before.id },
        data: { ...(dto.methods && { methods: dto.methods }), ...(dto.isActive !== undefined && { isActive: dto.isActive }) },
      });
      await this.audit.record(tx, {
        action: 'gateway.update',
        entityType: 'gateway_account',
        entityId: account.id,
        before: { methods: before.methods, isActive: before.isActive },
        after: { methods: account.methods, isActive: account.isActive },
      });
      return account;
    });
    return this.present(saved);
  }

  /** Desconectar = desactivar: los pagos ya hechos conservan su historial. */
  async disconnect(org: OrgContext) {
    return this.update(org, { isActive: false });
  }

  // ---------------------------------------------------------------------------
  // Uso interno (sistema): credenciales descifradas
  // ---------------------------------------------------------------------------

  toCredentials(a: GatewayAccount): WompiCredentials {
    return {
      environment: a.environment,
      publicKey: a.publicKey,
      privateKey: decrypt(a.privateKeyEnc),
      integritySecret: decrypt(a.integritySecretEnc),
      eventsSecret: decrypt(a.eventsSecretEnc),
    };
  }

  async credentials(accountId: string): Promise<WompiCredentials> {
    const a = await this.db.system.gatewayAccount.findUnique({ where: { id: accountId } });
    if (!a) throw Errors.notFound('la cuenta de pagos');
    return this.toCredentials(a);
  }

  /** Cuenta Wompi de Rifa Star, la que cobra los planes. Con el driver simulado hay llaves de mentira. */
  platformCredentials(): WompiCredentials {
    const e = env();
    if (wompiDriver() === 'fake' && !e.WOMPI_PUBLIC_KEY) {
      return { environment: 'sandbox', publicKey: 'pub_test_simulada', privateKey: 'prv_test_simulada', integritySecret: 'test_integrity_simulada', eventsSecret: 'test_events_simulada' };
    }
    const keys = { publicKey: e.WOMPI_PUBLIC_KEY, privateKey: e.WOMPI_PRIVATE_KEY, integritySecret: e.WOMPI_INTEGRITY_SECRET, eventsSecret: e.WOMPI_EVENTS_SECRET };
    if (!keys.publicKey || !keys.privateKey || !keys.integritySecret || !keys.eventsSecret) {
      throw new AppError('GATEWAY_NOT_CONFIGURED', 409, 'El cobro en línea de los planes todavía no está disponible. Escríbenos a soporte.');
    }
    const detected = keysEnvironment(keys);
    if ('error' in detected) throw new AppError('GATEWAY_NOT_CONFIGURED', 500, 'La configuración de Wompi de Rifa Star es inválida.', { problem: detected.error });
    return { ...keys, environment: detected.environment };
  }
}
