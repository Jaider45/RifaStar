import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { Errors } from '../common/errors';
import { formatNumber } from '../common/format';
import { DatabaseService } from '../database/database.service';
import { StorageProvider } from '../storage/storage.provider';
import type { OrgContext } from '../tenancy/org-context';
import { SettingsService } from '../settings/settings.service';

const ORDER_INCLUDE = { raffle: true, participant: true, incomeReceipt: true } as const;
type ReceiptSnapshot = {
  issuer: { name: string; taxId: string; address: string; phone: string; email: string; logoKey: string | null; accentColor: string };
  customer: { name: string; phone: string };
  purchase: { concept: string; raffle: string; quantity: number; unitLabel: string; unitPriceCop: number; totalCop: number; numbers: string[] };
  issuedAt: string;
  paidAt: string;
  footer: string;
  disclaimer: string;
};

@Injectable()
export class ReceiptsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly storage: StorageProvider,
  ) {}

  eligible(org: OrgContext) {
    return this.db.tenantTx(org.id, async (tx) => {
      const orders = await tx.order.findMany({
        where: { status: 'approved', incomeReceipt: null },
        include: { raffle: { select: { title: true } }, participant: { select: { name: true } } },
        orderBy: [{ verifiedAt: 'desc' }, { createdAt: 'desc' }],
        take: 200,
      });
      return orders.map((order) => ({
        orderId: order.id,
        customer: order.participant.name,
        raffle: order.raffle.title,
        quantity: order.numbers.length,
        totalCop: order.totalCop,
        paidAt: order.verifiedAt ?? order.updatedAt,
      }));
    });
  }

  list(org: OrgContext) {
    return this.db.tenantTx(org.id, async (tx) => {
      const rows = await tx.incomeReceipt.findMany({
        orderBy: { issuedAt: 'desc' },
        take: 200,
        include: { order: { select: { participant: { select: { name: true } } } } },
      });
      return rows.map((r) => ({
        id: r.id,
        sequence: r.sequence,
        customer: r.order.participant.name,
        issuedAt: r.issuedAt,
        totalCop: (r.snapshot as unknown as ReceiptSnapshot).purchase.totalCop,
        quantity: (r.snapshot as unknown as ReceiptSnapshot).purchase.quantity,
        voidedAt: r.voidedAt,
      }));
    });
  }

  async issue(org: OrgContext, orderId: string) {
    try {
      const id = await this.db.tenantTx(org.id, async (tx) => {
        const order = await tx.order.findFirst({ where: { id: orderId }, include: ORDER_INCLUDE });
        if (!order) throw Errors.notFound('la compra');
        if (order.incomeReceipt) return order.incomeReceipt.id;
        if (order.status !== 'approved') {
          throw Errors.conflict('RECEIPT_ORDER_NOT_APPROVED', 'Solo puedes emitir comprobantes de compras aprobadas.');
        }

        const config = (await this.settings.read(tx, 'receipts')).data;
        const [sequenceRow, organization] = await Promise.all([
          tx.organization.update({ where: { id: org.id }, data: { receiptSequence: { increment: 1 } }, select: { receiptSequence: true } }),
          tx.organization.findUniqueOrThrow({ where: { id: org.id }, select: { name: true, logoKey: true, defaultAccentColor: true } }),
        ]);
        const quantity = order.numbers.length;
        const replacements: Record<string, string> = {
          cantidad: String(quantity),
          concepto: config.unitLabel,
          sorteo: order.raffle.title,
        };
        const concept = config.conceptTemplate.replace(/\{(cantidad|concepto|sorteo)\}/g, (_match, key: string) => replacements[key]);
        const paidAt = order.verifiedAt ?? order.updatedAt;
        const issuedAt = new Date();
        const snapshot: ReceiptSnapshot = {
          issuer: {
            name: config.issuerName || organization.name,
            taxId: config.taxId,
            address: config.address,
            phone: config.phone,
            email: config.email,
            logoKey: organization.logoKey,
            accentColor: organization.defaultAccentColor,
          },
          customer: { name: order.participant.name, phone: order.participant.phone },
          purchase: {
            concept,
            raffle: order.raffle.title,
            quantity,
            unitLabel: config.unitLabel,
            unitPriceCop: order.unitPrice,
            totalCop: order.totalCop,
            numbers: order.numbers.map((n) => formatNumber(n, order.raffle.digits)),
          },
          issuedAt: issuedAt.toISOString(),
          paidAt: paidAt.toISOString(),
          footer: config.footer,
          disclaimer: 'Comprobante interno de ingreso. No es una factura electrónica de venta.',
        };
        const receipt = await tx.incomeReceipt.create({
          data: {
            organizationId: org.id,
            orderId,
            sequence: sequenceRow.receiptSequence,
            snapshot: snapshot as unknown as Prisma.InputJsonValue,
            issuedById: org.memberId,
            issuedAt,
          },
        });
        await this.audit.record(tx, {
          action: 'receipt.issue',
          entityType: 'income_receipt',
          entityId: receipt.id,
          after: { sequence: receipt.sequence, orderId, totalCop: order.totalCop, quantity },
        });
        return receipt.id;
      });
      return this.get(org, id);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const existing = await this.db.tenantTx(org.id, (tx) => tx.incomeReceipt.findFirst({ where: { orderId }, select: { id: true } }));
        if (existing) return this.get(org, existing.id);
      }
      throw err;
    }
  }

  async get(org: OrgContext, id: string) {
    const receipt = await this.db.tenantTx(org.id, (tx) => tx.incomeReceipt.findFirst({ where: { id } }));
    if (!receipt) throw Errors.notFound('el comprobante');
    const snapshot = receipt.snapshot as unknown as ReceiptSnapshot;
    const logoUrl = snapshot.issuer.logoKey ? await this.storage.signedGetUrl(snapshot.issuer.logoKey, 3600) : null;
    return {
      id: receipt.id,
      sequence: receipt.sequence,
      issuedAt: receipt.issuedAt,
      voidedAt: receipt.voidedAt,
      voidReason: receipt.voidReason,
      snapshot: { ...snapshot, issuer: { ...snapshot.issuer, logoUrl } },
    };
  }
}
