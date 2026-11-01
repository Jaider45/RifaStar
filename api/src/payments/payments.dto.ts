import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { zEmail, zUuid } from '../common/zod';
import { WOMPI_METHODS } from './wompi/types';

const key = (label: string) => z.string().trim().min(10, `Pega ${label} completa.`).max(200);

/** Conectar (o reemplazar) las llaves de Wompi de la organización. */
export class ConnectGatewayDto extends createZodDto(
  z.object({
    publicKey: key('la llave pública'),
    privateKey: key('la llave privada'),
    integritySecret: key('el secreto de integridad'),
    eventsSecret: key('el secreto de eventos'),
    methods: z.array(z.enum(WOMPI_METHODS)).min(1, 'Elige al menos un medio de pago.').default([...WOMPI_METHODS]),
  }),
) {}

export class UpdateGatewayDto extends createZodDto(
  z.object({
    methods: z.array(z.enum(WOMPI_METHODS)).min(1, 'Elige al menos un medio de pago.').optional(),
    isActive: z.boolean().optional(),
  }),
) {}

export class ListOnlinePaymentsQuery extends createZodDto(
  z.object({
    status: z.enum(['pending', 'approved', 'declined', 'voided', 'error']).optional(),
    refundRequired: z.enum(['true']).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  }),
) {}

export class RefundDoneDto extends createZodDto(z.object({ note: z.string().trim().min(3, 'Cuenta cómo se reembolsó.').max(300) })) {}

const accepted = (msg: string) => z.boolean().refine((v) => v === true, msg);

/** Tipos de documento que acepta PSE. */
export const LEGAL_ID_TYPES = ['CC', 'CE', 'NIT', 'TI', 'PP', 'IDC', 'CEL', 'RC', 'DE'] as const;

const PayOrderSchema = z
  .object({
    method: z.enum(WOMPI_METHODS),
    email: zEmail,
    acceptTerms: accepted('Acepta los términos y condiciones de Wompi para pagar.'),
    acceptPersonalData: accepted('Autoriza el tratamiento de tus datos personales para pagar.'),
    /** Tarjeta: token que el navegador obtuvo de Wompi (el número de la tarjeta nunca llega aquí). */
    cardToken: z.string().trim().min(5).max(200).optional(),
    installments: z.number().int().min(1).max(36).default(1),
    /** Nequi: celular de 10 dígitos que empieza por 3. */
    phone: z.string().trim().regex(/^(\+?57)?\s?3\d{9}$/, 'Escribe el celular de Nequi: 10 dígitos que empiezan por 3.').optional(),
    pse: z
      .object({
        userType: z.union([z.literal(0), z.literal(1)]),
        legalIdType: z.enum(LEGAL_ID_TYPES),
        legalId: z.string().trim().regex(/^\d{5,15}$/, 'El documento solo lleva números (5 a 15).'),
        bankCode: z.string().trim().min(1).max(10),
      })
      .optional(),
  })
  .superRefine((v, ctx) => {
    const need = (ok: boolean, path: string, message: string) => ok || ctx.addIssue({ code: 'custom', path: [path], message });
    if (v.method === 'CARD') need(Boolean(v.cardToken), 'cardToken', 'Falta la tarjeta.');
    if (v.method === 'NEQUI') need(Boolean(v.phone), 'phone', 'Escribe el celular de Nequi.');
    if (v.method === 'PSE') need(Boolean(v.pse), 'pse', 'Completa los datos de PSE.');
  });

export type PayOrderInput = z.infer<typeof PayOrderSchema>;

/**
 * Pago de una orden con el checkout propio. Los datos de la tarjeta NO viajan por aquí: el
 * navegador los envía directo a Wompi con la llave pública y a la API solo llega el token.
 */
export class PayOrderDto extends createZodDto(PayOrderSchema) {}

/** Suscribirse a un plan con tarjeta (checkout propio). */
export class SubscribePlanDto extends createZodDto(
  z.object({
    planCode: z.string().trim().min(2).max(40),
    cardToken: z.string().trim().min(5).max(200),
    acceptTerms: accepted('Acepta los términos y condiciones de Wompi para pagar.'),
    acceptPersonalData: accepted('Autoriza el tratamiento de tus datos personales para pagar.'),
  }),
) {}

/** Cambiar la tarjeta con la que se renueva el plan. */
export class ChangeCardDto extends createZodDto(
  z.object({
    cardToken: z.string().trim().min(5).max(200),
    acceptTerms: accepted('Acepta los términos y condiciones de Wompi para continuar.'),
    acceptPersonalData: accepted('Autoriza el tratamiento de tus datos personales para continuar.'),
  }),
) {}

export class PaymentIdParam extends createZodDto(z.object({ id: zUuid })) {}
