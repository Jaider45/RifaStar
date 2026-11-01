/** Tipos de la API de Wompi normalizados (camelCase) para el resto del código. */

export type WompiEnvironment = 'sandbox' | 'production';
export type WompiStatus = 'PENDING' | 'APPROVED' | 'DECLINED' | 'VOIDED' | 'ERROR';

/** Medios del checkout propio. Los demás de Wompi (QR, Daviplata, BNPL…) se agregan aquí. */
export const WOMPI_METHODS = ['CARD', 'NEQUI', 'PSE', 'BANCOLOMBIA_TRANSFER'] as const;
export type WompiMethod = (typeof WOMPI_METHODS)[number];

export interface WompiCredentials {
  environment: WompiEnvironment;
  publicKey: string;
  privateKey: string;
  integritySecret: string;
  eventsSecret: string;
}

/** Contratos que el pagador debe aceptar (Wompi exige ambos tokens en cada transacción nueva). */
export interface WompiMerchant {
  name: string;
  acceptance: { token: string; permalink: string };
  personalData: { token: string; permalink: string };
}

export interface WompiTransaction {
  id: string;
  reference: string;
  status: WompiStatus;
  statusMessage: string | null;
  amountInCents: number;
  currency: string;
  paymentMethodType: string | null;
  /** PSE y Bancolombia: página del banco. Puede tardar unos segundos en aparecer. */
  asyncPaymentUrl: string | null;
}

export type WompiPaymentMethod =
  | { type: 'CARD'; token: string; installments: number }
  | { type: 'NEQUI'; phoneNumber: string }
  | { type: 'PSE'; userType: 0 | 1; legalIdType: string; legalId: string; bankCode: string; description: string }
  | { type: 'BANCOLOMBIA_TRANSFER'; description: string };

export interface CreateTransactionInput {
  reference: string;
  amountInCents: number;
  customerEmail: string;
  acceptanceToken?: string;
  acceptPersonalAuth?: string;
  redirectUrl?: string;
  customerData?: { fullName: string; phoneNumber: string };
  paymentMethod?: WompiPaymentMethod;
  /** Cobro con una tarjeta guardada (planes). */
  paymentSourceId?: string;
  recurrent?: boolean;
}

export interface WompiPaymentSource {
  id: string;
  status: string;
  brand: string | null;
  lastFour: string | null;
  expMonth: string | null;
  expYear: string | null;
}

/** Evento que Wompi envía al webhook. */
export interface WompiEvent {
  event: string;
  data: Record<string, unknown>;
  environment?: string;
  signature: { properties: string[]; checksum: string };
  timestamp: number;
  sent_at?: string;
}
