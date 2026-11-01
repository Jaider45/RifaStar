import { Injectable, Logger } from '@nestjs/common';
import { AppError } from '../../common/errors';
import { apiPublicUrl, env } from '../../config/env';
import { integritySignature } from './signatures';
import type {
  CreateTransactionInput,
  WompiCredentials,
  WompiEnvironment,
  WompiMerchant,
  WompiPaymentSource,
  WompiStatus,
  WompiTransaction,
} from './types';

/**
 * Cliente de la API de Wompi. Todo lo que usa la llave privada pasa por aquí (servidor); la
 * tarjeta se tokeniza en el navegador con la llave pública y nunca llega a la API de Rifa Star.
 */
export abstract class WompiClient {
  abstract readonly driver: 'wompi' | 'fake';
  /** Contratos vigentes del comercio (tokens de aceptación) y su nombre. */
  abstract merchant(environment: WompiEnvironment, publicKey: string): Promise<WompiMerchant>;
  abstract pseBanks(environment: WompiEnvironment, publicKey: string): Promise<{ code: string; name: string }[]>;
  abstract createTransaction(creds: WompiCredentials, input: CreateTransactionInput): Promise<WompiTransaction>;
  abstract getTransaction(creds: WompiCredentials, id: string): Promise<WompiTransaction>;
  /** Comprueba que la llave privada sea válida (consulta transacciones por una referencia inexistente). */
  abstract verifyPrivateKey(creds: WompiCredentials): Promise<void>;
  abstract createPaymentSource(
    creds: WompiCredentials,
    input: { token: string; customerEmail: string; acceptanceToken: string; acceptPersonalAuth: string },
  ): Promise<WompiPaymentSource>;

  baseUrl(environment: WompiEnvironment): string {
    return (environment === 'production' ? env().WOMPI_PRODUCTION_URL : env().WOMPI_SANDBOX_URL).replace(/\/+$/, '');
  }
}

/** Respuesta de error de Wompi: { error: { type, reason?, messages?: { campo: [mensajes] } } }. */
function gatewayError(status: number, body: unknown): AppError {
  const err = (body as { error?: { type?: string; reason?: string; messages?: Record<string, string[]> } })?.error;
  const detail = err?.messages ? Object.entries(err.messages).map(([k, v]) => `${k}: ${[v].flat().join(', ')}`).join(' · ') : (err?.reason ?? null);
  if (status === 401 || status === 403) {
    return new AppError('GATEWAY_AUTH', 502, 'Wompi rechazó las llaves de la cuenta. Revisa la configuración de pagos en línea.', { type: err?.type });
  }
  if (status === 422 || err?.type === 'INPUT_VALIDATION_ERROR') {
    return new AppError('GATEWAY_REJECTED', 422, `Wompi no aceptó el pago${detail ? `: ${detail}` : '.'}`, { type: err?.type });
  }
  return new AppError('GATEWAY_UNAVAILABLE', 502, 'La pasarela de pagos no respondió. Intenta de nuevo en unos minutos.', { status, type: err?.type });
}

const STATUSES = new Set<WompiStatus>(['PENDING', 'APPROVED', 'DECLINED', 'VOIDED', 'ERROR']);

export function normalizeTransaction(d: Record<string, unknown>): WompiTransaction {
  const method = (d.payment_method ?? {}) as { type?: string; extra?: { async_payment_url?: string } };
  const status = String(d.status ?? 'PENDING').toUpperCase() as WompiStatus;
  return {
    id: String(d.id),
    reference: String(d.reference ?? ''),
    status: STATUSES.has(status) ? status : 'ERROR',
    statusMessage: (d.status_message as string | null | undefined) ?? null,
    amountInCents: Number(d.amount_in_cents ?? 0),
    currency: String(d.currency ?? 'COP'),
    paymentMethodType: (d.payment_method_type as string | undefined) ?? method.type ?? null,
    asyncPaymentUrl: method.extra?.async_payment_url ?? null,
  };
}

/** Cuerpo de POST /transactions según el medio (ver docs.wompi.co › Métodos de pago). */
export function transactionBody(creds: WompiCredentials, input: CreateTransactionInput): Record<string, unknown> {
  const pm = input.paymentMethod;
  const paymentMethod =
    pm?.type === 'CARD'
      ? { type: 'CARD', token: pm.token, installments: pm.installments }
      : pm?.type === 'NEQUI'
        ? { type: 'NEQUI', phone_number: pm.phoneNumber }
        : pm?.type === 'PSE'
          ? {
              type: 'PSE',
              user_type: pm.userType,
              user_legal_id_type: pm.legalIdType,
              user_legal_id: pm.legalId,
              financial_institution_code: pm.bankCode,
              payment_description: pm.description,
            }
          : pm?.type === 'BANCOLOMBIA_TRANSFER'
            ? { type: 'BANCOLOMBIA_TRANSFER', user_type: 'PERSON', payment_description: pm.description }
            : // Tarjeta guardada: solo las cuotas.
              input.paymentSourceId
              ? { installments: 1 }
              : undefined;
  return {
    amount_in_cents: input.amountInCents,
    currency: 'COP',
    signature: integritySignature(input.reference, input.amountInCents, 'COP', creds.integritySecret),
    customer_email: input.customerEmail,
    reference: input.reference,
    ...(input.acceptanceToken && { acceptance_token: input.acceptanceToken }),
    ...(input.acceptPersonalAuth && { accept_personal_auth: input.acceptPersonalAuth }),
    ...(input.redirectUrl && { redirect_url: input.redirectUrl }),
    ...(input.customerData && { customer_data: { full_name: input.customerData.fullName, phone_number: input.customerData.phoneNumber } }),
    ...(paymentMethod && { payment_method: paymentMethod }),
    ...(input.paymentSourceId && { payment_source_id: Number.isNaN(Number(input.paymentSourceId)) ? input.paymentSourceId : Number(input.paymentSourceId) }),
    ...(input.recurrent !== undefined && { recurrent: input.recurrent }),
  };
}

@Injectable()
export class HttpWompiClient extends WompiClient {
  readonly driver = 'wompi' as const;
  private readonly logger = new Logger('Wompi');
  private readonly merchants = new Map<string, { at: number; value: WompiMerchant }>();
  private readonly banks = new Map<string, { at: number; value: { code: string; name: string }[] }>();

  private async call<T>(environment: WompiEnvironment, method: string, path: string, opts: { bearer?: string; headers?: Record<string, string>; body?: unknown } = {}): Promise<{ status: number; body: T }> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl(environment)}${path}`, {
        method,
        headers: {
          Accept: 'application/json',
          ...(opts.body !== undefined && { 'Content-Type': 'application/json' }),
          ...(opts.bearer && { Authorization: `Bearer ${opts.bearer}` }),
          ...opts.headers,
        },
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (err) {
      this.logger.warn(`${method} ${path}: ${(err as Error).message}`);
      throw new AppError('GATEWAY_UNAVAILABLE', 502, 'La pasarela de pagos no respondió. Intenta de nuevo en unos minutos.');
    }
    const body = (await res.json().catch(() => ({}))) as T;
    return { status: res.status, body };
  }

  private async ok<T>(environment: WompiEnvironment, method: string, path: string, opts: Parameters<HttpWompiClient['call']>[3] = {}): Promise<T> {
    const r = await this.call<{ data: T }>(environment, method, path, opts);
    if (r.status >= 400) throw gatewayError(r.status, r.body);
    return r.body.data;
  }

  async merchant(environment: WompiEnvironment, publicKey: string): Promise<WompiMerchant> {
    const cached = this.merchants.get(publicKey);
    if (cached && Date.now() - cached.at < 10 * 60_000) return cached.value;
    // Endpoint vigente: /merchants/info con la llave en cabecera. El anterior (/merchants/:llave) es el respaldo.
    let r = await this.call<{ data?: Record<string, unknown> }>(environment, 'GET', '/merchants/info', { headers: { 'x-merchant-public-key': publicKey } });
    if (r.status === 404 || r.status === 405) r = await this.call(environment, 'GET', `/merchants/${encodeURIComponent(publicKey)}`);
    if (r.status >= 400 || !r.body.data) {
      throw r.status === 404 || r.status === 401 || r.status === 422
        ? new AppError('GATEWAY_AUTH', 422, 'Wompi no reconoce esa llave pública. Revisa que la hayas copiado completa.')
        : gatewayError(r.status, r.body);
    }
    const d = r.body.data as {
      name?: string;
      presigned_acceptance?: { acceptance_token: string; permalink: string };
      presigned_personal_data_auth?: { acceptance_token: string; permalink: string };
    };
    if (!d.presigned_acceptance || !d.presigned_personal_data_auth) {
      throw new AppError('GATEWAY_UNAVAILABLE', 502, 'Wompi no entregó los contratos de aceptación. Intenta de nuevo en unos minutos.');
    }
    const value: WompiMerchant = {
      name: d.name ?? '',
      acceptance: { token: d.presigned_acceptance.acceptance_token, permalink: d.presigned_acceptance.permalink },
      personalData: { token: d.presigned_personal_data_auth.acceptance_token, permalink: d.presigned_personal_data_auth.permalink },
    };
    this.merchants.set(publicKey, { at: Date.now(), value });
    return value;
  }

  async pseBanks(environment: WompiEnvironment, publicKey: string): Promise<{ code: string; name: string }[]> {
    const cached = this.banks.get(environment);
    if (cached && Date.now() - cached.at < 60 * 60_000) return cached.value;
    const rows = await this.ok<Record<string, string>[]>(environment, 'GET', '/pse/financial_institutions', { bearer: publicKey });
    const value = rows
      .map((b) => ({ code: String(b.financial_institution_code ?? b.code), name: String(b.financial_institution_name ?? b.name) }))
      // Wompi incluye una fila guía con código «0» («A continuación seleccione su banco»).
      .filter((b) => b.code && b.code !== '0');
    this.banks.set(environment, { at: Date.now(), value });
    return value;
  }

  async createTransaction(creds: WompiCredentials, input: CreateTransactionInput): Promise<WompiTransaction> {
    const data = await this.ok<Record<string, unknown>>(creds.environment, 'POST', '/transactions', { bearer: creds.privateKey, body: transactionBody(creds, input) });
    return normalizeTransaction(data);
  }

  async getTransaction(creds: WompiCredentials, id: string): Promise<WompiTransaction> {
    const data = await this.ok<Record<string, unknown>>(creds.environment, 'GET', `/transactions/${encodeURIComponent(id)}`, { bearer: creds.privateKey });
    return normalizeTransaction(data);
  }

  async verifyPrivateKey(creds: WompiCredentials): Promise<void> {
    const r = await this.call(creds.environment, 'GET', `/transactions?reference=rifastar-verificacion-${Date.now()}`, { bearer: creds.privateKey });
    if (r.status === 401 || r.status === 403) {
      throw new AppError('GATEWAY_AUTH', 422, 'Wompi rechazó la llave privada. Revisa que sea la de la misma cuenta que la pública.');
    }
    if (r.status >= 500) throw gatewayError(r.status, r.body);
  }

  async createPaymentSource(
    creds: WompiCredentials,
    input: { token: string; customerEmail: string; acceptanceToken: string; acceptPersonalAuth: string },
  ): Promise<WompiPaymentSource> {
    const d = await this.ok<{ id: number | string; status: string; public_data?: Record<string, unknown> }>(creds.environment, 'POST', '/payment_sources', {
      bearer: creds.privateKey,
      body: { type: 'CARD', token: input.token, customer_email: input.customerEmail, acceptance_token: input.acceptanceToken, accept_personal_auth: input.acceptPersonalAuth },
    });
    const pub = d.public_data ?? {};
    return {
      id: String(d.id),
      status: d.status,
      brand: (pub.brand as string | undefined) ?? null,
      lastFour: (pub.last_four as string | undefined) ?? null,
      expMonth: (pub.exp_month as string | undefined) ?? null,
      expYear: (pub.exp_year as string | undefined) ?? null,
    };
  }
}

/**
 * Wompi simulado para desarrollo y tests, con los datos del sandbox: tarjetas terminadas en 4242
 * se aprueban y en 1111 se rechazan; Nequi 3991111111 aprueba y 3992222222 rechaza; en PSE el
 * banco «1» aprueba y el «2» rechaza. La transacción nace PENDING y se resuelve al consultarla.
 */
@Injectable()
export class FakeWompiClient extends WompiClient {
  readonly driver = 'fake' as const;
  private seq = 0;

  /** La tarjeta se tokeniza en el endpoint simulado de nuestra propia API (ver SimulatedWompiController). */
  override baseUrl(): string {
    return `${apiPublicUrl()}/v1/dev/wompi`;
  }
  readonly transactions = new Map<string, { tx: WompiTransaction; outcome: WompiStatus; body: Record<string, unknown> }>();
  private readonly sources = new Map<string, WompiStatus>();

  async merchant(_environment: WompiEnvironment, publicKey: string): Promise<WompiMerchant> {
    if (!publicKey.startsWith('pub_')) throw new AppError('GATEWAY_AUTH', 422, 'Wompi no reconoce esa llave pública. Revisa que la hayas copiado completa.');
    return {
      name: 'Comercio de pruebas',
      acceptance: { token: `fake-acceptance-${publicKey.slice(-6)}`, permalink: 'https://wompi.com/assets/downloadble/reglamento-Usuarios-Colombia.pdf' },
      personalData: { token: `fake-personal-${publicKey.slice(-6)}`, permalink: 'https://wompi.com/assets/downloadble/autorizacion-administracion-datos-personales.pdf' },
    };
  }

  async pseBanks(): Promise<{ code: string; name: string }[]> {
    return [
      { code: '1', name: 'Banco que aprueba' },
      { code: '2', name: 'Banco que rechaza' },
    ];
  }

  private outcomeFor(input: CreateTransactionInput): WompiStatus {
    const pm = input.paymentMethod;
    if (input.paymentSourceId) return this.sources.get(input.paymentSourceId) ?? 'ERROR';
    if (pm?.type === 'CARD') return pm.token.endsWith('4242') ? 'APPROVED' : pm.token.endsWith('1111') ? 'DECLINED' : 'ERROR';
    if (pm?.type === 'NEQUI') return pm.phoneNumber === '3991111111' ? 'APPROVED' : pm.phoneNumber === '3992222222' ? 'DECLINED' : 'ERROR';
    if (pm?.type === 'PSE') return pm.bankCode === '1' ? 'APPROVED' : pm.bankCode === '2' ? 'DECLINED' : 'ERROR';
    return 'APPROVED';
  }

  async createTransaction(creds: WompiCredentials, input: CreateTransactionInput): Promise<WompiTransaction> {
    if (!input.paymentSourceId && (!input.acceptanceToken || !input.acceptPersonalAuth)) {
      throw new AppError('GATEWAY_REJECTED', 422, 'Wompi no aceptó el pago: faltan los tokens de aceptación.');
    }
    const id = `fake-${Date.now()}-${++this.seq}`;
    const type = input.paymentMethod?.type ?? 'CARD';
    const tx: WompiTransaction = {
      id,
      reference: input.reference,
      status: 'PENDING',
      statusMessage: null,
      amountInCents: input.amountInCents,
      currency: 'COP',
      paymentMethodType: type,
      asyncPaymentUrl: type === 'PSE' || type === 'BANCOLOMBIA_TRANSFER' ? `https://pagos.local/wompi/${type.toLowerCase()}/${id}` : null,
    };
    this.transactions.set(id, { tx, outcome: this.outcomeFor(input), body: transactionBody(creds, input) });
    return { ...tx };
  }

  async getTransaction(_creds: WompiCredentials, id: string): Promise<WompiTransaction> {
    const row = this.transactions.get(id);
    if (!row) throw new AppError('GATEWAY_REJECTED', 422, 'Wompi no encontró la transacción.');
    if (row.tx.status === 'PENDING') {
      row.tx.status = row.outcome;
      row.tx.statusMessage = row.outcome === 'DECLINED' ? 'Transacción rechazada por el banco' : row.outcome === 'ERROR' ? 'Error en la transacción' : null;
    }
    return { ...row.tx };
  }

  /** Tests: fija el estado final de una transacción (p. ej. para simular un webhook). */
  settle(id: string, status: WompiStatus): WompiTransaction {
    const row = this.transactions.get(id)!;
    row.tx.status = status;
    return { ...row.tx };
  }

  async verifyPrivateKey(creds: WompiCredentials): Promise<void> {
    if (!creds.privateKey.startsWith('prv_')) throw new AppError('GATEWAY_AUTH', 422, 'Wompi rechazó la llave privada. Revisa que sea la de la misma cuenta que la pública.');
  }

  async createPaymentSource(_creds: WompiCredentials, input: { token: string; customerEmail: string }): Promise<WompiPaymentSource> {
    const id = String(10_000 + ++this.seq);
    const approved = input.token.endsWith('4242');
    this.sources.set(id, approved ? 'APPROVED' : input.token.endsWith('1111') ? 'DECLINED' : 'ERROR');
    return { id, status: 'AVAILABLE', brand: 'VISA', lastFour: input.token.slice(-4), expMonth: '12', expYear: '30' };
  }

  /** Tests: la tarjeta guardada empieza a rechazar los cobros (renovación fallida). */
  failSource(id: string): void {
    this.sources.set(id, 'DECLINED');
  }
}
