import { Body, Controller, Delete, Get, HttpCode, Injectable, Module, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PaymentAccountType } from '@prisma/client';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { Errors } from '../common/errors';
import { AuditService } from '../audit/audit.service';
import { DatabaseService } from '../database/database.service';
import { CurrentOrg, OrgScoped, RequirePermission } from '../permissions/decorators';
import type { OrgContext } from '../tenancy/org-context';

export const PAYMENT_ACCOUNT_LABELS: Record<PaymentAccountType, string> = {
  bre_b: 'Llave Bre-B',
  nequi: 'Nequi',
  daviplata: 'Daviplata',
  bank_transfer: 'Transferencia bancaria',
};

const Fields = z.object({
  type: z.nativeEnum(PaymentAccountType),
  keyOrNumber: z.string().trim().min(3).max(60),
  holderName: z.string().trim().min(2).max(120),
  bankName: z.string().trim().min(2).max(80).nullable().optional(),
  accountKind: z.enum(['ahorros', 'corriente']).nullable().optional(),
  sortOrder: z.number().int().min(0).max(100).optional(),
});

const bankRequired = (v: z.infer<typeof Fields> | Partial<z.infer<typeof Fields>>, ctx: z.RefinementCtx) => {
  if (v.type === 'bank_transfer' && (!v.bankName || !v.accountKind)) {
    ctx.addIssue({ code: 'custom', path: ['bankName'], message: 'Para transferencia indica el banco y el tipo de cuenta.' });
  }
};

class CreatePaymentAccountDto extends createZodDto(Fields.superRefine(bankRequired)) {}
class UpdatePaymentAccountDto extends createZodDto(Fields.partial().superRefine(bankRequired)) {}

export function presentPaymentAccount(a: {
  id: string;
  type: PaymentAccountType;
  keyOrNumber: string;
  holderName: string;
  bankName: string | null;
  accountKind: string | null;
}) {
  return {
    id: a.id,
    type: a.type,
    typeLabel: PAYMENT_ACCOUNT_LABELS[a.type],
    keyOrNumber: a.keyOrNumber,
    holderName: a.holderName,
    bankName: a.bankName,
    accountKind: a.accountKind,
  };
}

@Injectable()
export class PaymentAccountsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  list(org: OrgContext) {
    return this.db.tenantTx(org.id, async (tx) =>
      (await tx.paymentAccount.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] })).map(
        presentPaymentAccount,
      ),
    );
  }

  create(org: OrgContext, dto: CreatePaymentAccountDto) {
    return this.db.tenantTx(org.id, async (tx) => {
      const created = await tx.paymentAccount.create({ data: { ...dto, organizationId: org.id } });
      await this.audit.record(tx, { action: 'payment_account.create', entityType: 'payment_account', entityId: created.id, after: presentPaymentAccount(created) });
      return presentPaymentAccount(created);
    });
  }

  update(org: OrgContext, id: string, dto: UpdatePaymentAccountDto) {
    return this.db.tenantTx(org.id, async (tx) => {
      const current = await tx.paymentAccount.findFirst({ where: { id, isActive: true } });
      if (!current) throw Errors.notFound('la cuenta de pago');
      const updated = await tx.paymentAccount.update({ where: { id }, data: dto });
      await this.audit.record(tx, {
        action: 'payment_account.update',
        entityType: 'payment_account',
        entityId: id,
        before: presentPaymentAccount(current),
        after: presentPaymentAccount(updated),
      });
      return presentPaymentAccount(updated);
    });
  }

  /** Se desactiva (no se borra) para conservar el historial de los sorteos. */
  remove(org: OrgContext, id: string) {
    return this.db.tenantTx(org.id, async (tx) => {
      const current = await tx.paymentAccount.findFirst({ where: { id, isActive: true } });
      if (!current) throw Errors.notFound('la cuenta de pago');
      await tx.paymentAccount.update({ where: { id }, data: { isActive: false } });
      await tx.rafflePaymentAccount.deleteMany({
        where: { paymentAccountId: id, raffle: { status: { in: ['draft', 'active', 'sold_out'] } } },
      });
      await this.audit.record(tx, { action: 'payment_account.delete', entityType: 'payment_account', entityId: id, before: presentPaymentAccount(current) });
    });
  }
}

@ApiTags('Ajustes')
@OrgScoped()
@Controller('payment-accounts')
export class PaymentAccountsController {
  constructor(private readonly accounts: PaymentAccountsService) {}

  @Get()
  @RequirePermission('payments.view')
  list(@CurrentOrg() org: OrgContext) {
    return this.accounts.list(org);
  }

  @Post()
  @RequirePermission('settings.brand')
  create(@CurrentOrg() org: OrgContext, @Body() dto: CreatePaymentAccountDto) {
    return this.accounts.create(org, dto);
  }

  @Patch(':id')
  @RequirePermission('settings.brand')
  update(@CurrentOrg() org: OrgContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePaymentAccountDto) {
    return this.accounts.update(org, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('settings.brand')
  async remove(@CurrentOrg() org: OrgContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.accounts.remove(org, id);
  }
}

@Module({ controllers: [PaymentAccountsController], providers: [PaymentAccountsService] })
export class PaymentAccountsModule {}
