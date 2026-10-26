import { Injectable, Logger } from '@nestjs/common';
import { AppError } from '../common/errors';
import { env } from '../config/env';

/** Un sorteo del catálogo (lotería o chance) con su identificador en el proveedor. */
export interface DrawInfo {
  code: string; // `loteria-de-boyaca`
  name: string; // «Lotería de Boyacá»
  category: string; // loteria | chance | baloto
}

/** Resultado tal como lo entrega LoteríaYa (campos documentados en /api-loterias/documentacion). */
export interface ProviderResult {
  draw: string;
  name: string;
  category: string;
  draw_date: string; // YYYY-MM-DD, hora de Colombia
  draw_number?: string | null;
  winning_number: string | null;
  winning_series: string | null;
  fifth_digit?: string | null;
  status: 'confirmed' | 'preliminary' | 'disputed';
  published_at?: string | null;
  no_draw?: boolean;
}

/** Fuente de resultados de loterías. Intercambiable (LoteríaYa hoy). */
export abstract class LotteryProvider {
  abstract draws(): Promise<DrawInfo[]>;
  /** Todos los resultados de un día (YYYY-MM-DD). Vacío si todavía no hay ninguno. */
  abstract resultsByDate(date: string): Promise<ProviderResult[]>;
}

/**
 * Cliente de LoteríaYa: clave en la cabecera X-Api-Key, JSON, fechas de Colombia.
 * Errores con forma `{ error: { code, message } }`.
 */
@Injectable()
export class LoteriaYaProvider extends LotteryProvider {
  private readonly logger = new Logger(LoteriaYaProvider.name);

  private async get<T>(path: string): Promise<T> {
    const res = await fetch(`${env().LOTERIAYA_BASE_URL}${path}`, {
      headers: { 'X-Api-Key': env().LOTERIAYA_API_KEY, Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
    const remaining = res.headers.get('x-ratelimit-remaining');
    if (remaining && Number(remaining) < 500) this.logger.warn(`Cuota de LoteríaYa baja: quedan ${remaining} consultas este mes.`);
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
      throw new AppError(`LOTTERY_${(body.error?.code ?? 'error').toUpperCase()}`, 502, `LoteríaYa respondió ${res.status}: ${body.error?.message ?? 'error'}`, {
        status: res.status,
        retryAfter: res.headers.get('retry-after'),
      });
    }
    return (await res.json()) as T;
  }

  async draws(): Promise<DrawInfo[]> {
    const body = await this.get<{ draws?: { draw?: string; id?: string; name: string; category: string }[] } | { draw?: string; id?: string; name: string; category: string }[]>('/draws');
    const list = Array.isArray(body) ? body : (body.draws ?? []);
    return list.map((d) => ({ code: (d.draw ?? d.id)!, name: d.name, category: d.category }));
  }

  async resultsByDate(date: string): Promise<ProviderResult[]> {
    const body = await this.get<{ results: ProviderResult[] }>(`/results?date=${encodeURIComponent(date)}`);
    return body.results ?? [];
  }
}

/** Catálogo base para desarrollo (sin clave). Los identificadores siguen los de LoteríaYa. */
export const DEV_DRAWS: DrawInfo[] = [
  { code: 'loteria-de-boyaca', name: 'Lotería de Boyacá', category: 'loteria' },
  { code: 'loteria-de-medellin', name: 'Lotería de Medellín', category: 'loteria' },
  { code: 'loteria-de-bogota', name: 'Lotería de Bogotá', category: 'loteria' },
  { code: 'loteria-del-valle', name: 'Lotería del Valle', category: 'loteria' },
  { code: 'loteria-de-cundinamarca', name: 'Lotería de Cundinamarca', category: 'loteria' },
  { code: 'loteria-del-tolima', name: 'Lotería del Tolima', category: 'loteria' },
  { code: 'loteria-de-santander', name: 'Lotería de Santander', category: 'loteria' },
  { code: 'loteria-de-la-cruz-roja', name: 'Lotería de la Cruz Roja', category: 'loteria' },
  { code: 'loteria-del-huila', name: 'Lotería del Huila', category: 'loteria' },
  { code: 'loteria-del-meta', name: 'Lotería del Meta', category: 'loteria' },
  { code: 'loteria-de-manizales', name: 'Lotería de Manizales', category: 'loteria' },
  { code: 'loteria-del-quindio', name: 'Lotería del Quindío', category: 'loteria' },
  { code: 'loteria-de-risaralda', name: 'Lotería de Risaralda', category: 'loteria' },
  { code: 'loteria-del-cauca', name: 'Lotería del Cauca', category: 'loteria' },
  { code: 'antioquenita-dia', name: 'Antioqueñita Día', category: 'chance' },
  { code: 'antioquenita-tarde', name: 'Antioqueñita Tarde', category: 'chance' },
  { code: 'dorado-manana', name: 'Dorado Mañana', category: 'chance' },
  { code: 'dorado-tarde', name: 'Dorado Tarde', category: 'chance' },
  { code: 'dorado-noche', name: 'Dorado Noche', category: 'chance' },
  { code: 'chontico-dia', name: 'Chontico Día', category: 'chance' },
  { code: 'chontico-noche', name: 'Chontico Noche', category: 'chance' },
  { code: 'sinuano-dia', name: 'Sinuano Día', category: 'chance' },
  { code: 'sinuano-noche', name: 'Sinuano Noche', category: 'chance' },
  { code: 'paisita-dia', name: 'Paisita Día', category: 'chance' },
  { code: 'paisita-noche', name: 'Paisita Noche', category: 'chance' },
  { code: 'cafeterito-tarde', name: 'Cafeterito Tarde', category: 'chance' },
  { code: 'cafeterito-noche', name: 'Cafeterito Noche', category: 'chance' },
];

/** Desarrollo y tests: catálogo fijo y resultados cargados a mano con `set()`. */
@Injectable()
export class FakeLotteryProvider extends LotteryProvider {
  readonly results = new Map<string, ProviderResult[]>();
  calls = 0;

  async draws(): Promise<DrawInfo[]> {
    return DEV_DRAWS;
  }

  async resultsByDate(date: string): Promise<ProviderResult[]> {
    this.calls++;
    return this.results.get(date) ?? [];
  }

  set(date: string, results: ProviderResult[]): void {
    this.results.set(date, results);
  }
}
