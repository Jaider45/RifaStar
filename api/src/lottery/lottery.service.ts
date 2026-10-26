import { Injectable, Logger } from '@nestjs/common';
import type { LotteryResult } from '@prisma/client';
import { localDateKey } from '../common/time';
import { DatabaseService } from '../database/database.service';
import { ManagerAlertsService } from '../messaging/manager-alerts.service';
import { RedisService } from '../redis/redis.service';
import { type DrawInfo, LotteryProvider, type ProviderResult } from './lottery.provider';

/** Las fechas de LoteríaYa son de Colombia. */
const LOTTERY_TZ = 'America/Bogota';
const LIVE = ['active', 'sold_out', 'closed'] as const;
const CATALOG_KEY = 'lottery:draws:v1';

const toDate = (ymd: string) => new Date(`${ymd}T00:00:00Z`);
const DIGITS_RE = /^\d+$/;

/**
 * Resultados de loterías traídos de LoteríaYa (punto 1). Son INFORMATIVOS: se guardan una
 * sola vez para toda la plataforma y se avisa al equipo organizador; el resultado oficial
 * del sorteo lo ingresa el equipo a mano (con 2FA).
 */
@Injectable()
export class LotteryService {
  private readonly logger = new Logger(LotteryService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly provider: LotteryProvider,
    private readonly redis: RedisService,
    private readonly alerts: ManagerAlertsService,
  ) {}

  /** Catálogo de loterías y chances (en caché 24 h). */
  async catalog(): Promise<DrawInfo[]> {
    const cached = await this.redis.client.get(CATALOG_KEY);
    if (cached) return JSON.parse(cached) as DrawInfo[];
    const draws = (await this.provider.draws()).sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name, 'es'));
    await this.redis.client.set(CATALOG_KEY, JSON.stringify(draws), 'EX', 86_400);
    return draws;
  }

  /**
   * Guarda (o actualiza) resultados. Devuelve solo los que cambiaron: un resultado nuevo,
   * uno que pasó de preliminar a verificado, o una rectificación del operador.
   */
  async ingest(results: ProviderResult[]): Promise<LotteryResult[]> {
    const changed: LotteryResult[] = [];
    for (const r of results) {
      if (!r?.draw || !r.draw_date || r.no_draw) continue;
      if (r.winning_number !== null && !DIGITS_RE.test(r.winning_number ?? '')) continue;
      if (!['confirmed', 'preliminary', 'disputed'].includes(r.status)) continue;
      const drawDate = toDate(r.draw_date);
      const data = {
        drawName: r.name,
        winningNumber: r.winning_number,
        winningSeries: r.winning_series && DIGITS_RE.test(r.winning_series) ? r.winning_series : null,
        fifthDigit: r.fifth_digit && /^\d$/.test(r.fifth_digit) ? r.fifth_digit : null,
        status: r.status,
        publishedAt: r.published_at ? new Date(r.published_at) : null,
        raw: JSON.parse(JSON.stringify(r)),
      };
      const before = await this.db.system.lotteryResult.findUnique({ where: { drawCode_drawDate: { drawCode: r.draw, drawDate } } });
      const same =
        before &&
        before.winningNumber === data.winningNumber &&
        before.winningSeries === data.winningSeries &&
        before.fifthDigit === data.fifthDigit &&
        before.status === data.status;
      if (same) continue;
      const row = await this.db.system.lotteryResult.upsert({
        where: { drawCode_drawDate: { drawCode: r.draw, drawDate } },
        create: { drawCode: r.draw, drawDate, ...data },
        update: data,
      });
      changed.push(row);
    }
    for (const row of changed) await this.notifyFor(row).catch((err) => this.logger.warn(`Aviso de resultado falló: ${String(err)}`));
    return changed;
  }

  /** Avisa a los equipos cuyos sorteos juegan con esta lotería (o anticipado) en esa fecha. */
  private async notifyFor(lr: LotteryResult): Promise<void> {
    if (lr.status === 'disputed' || !lr.winningNumber) return;
    const ymd = lr.drawDate.toISOString().slice(0, 10);
    const from = new Date(lr.drawDate.getTime() - 86_400_000);
    const to = new Date(lr.drawDate.getTime() + 2 * 86_400_000);
    const raffles = await this.db.system.raffle.findMany({
      where: {
        deletedAt: null,
        status: { in: [...LIVE] },
        resultsPublishedAt: null,
        OR: [
          { lotteryDrawCode: lr.drawCode, drawAt: { gte: from, lt: to } },
          { prizes: { some: { anticipatedDrawCode: lr.drawCode } }, drawAt: { gte: from, lt: to } },
        ],
      },
      include: { prizes: true },
    });
    for (const raffle of raffles) {
      const anticipatedPrize = raffle.prizes.find((p) => p.anticipatedDrawCode);
      const mainMatches = raffle.lotteryDrawCode === lr.drawCode && localDateKey(raffle.drawAt, LOTTERY_TZ) === ymd;
      const anticipatedMatches =
        anticipatedPrize?.anticipatedDrawCode === lr.drawCode &&
        localDateKey(anticipatedPrize.anticipatedDrawAt ?? raffle.drawAt, LOTTERY_TZ) === ymd;
      if (!mainMatches && !anticipatedMatches) continue;

      const main = raffle.lotteryDrawCode
        ? await this.db.system.lotteryResult.findUnique({
            where: { drawCode_drawDate: { drawCode: raffle.lotteryDrawCode, drawDate: toDate(localDateKey(raffle.drawAt, LOTTERY_TZ)) } },
          })
        : null;
      const anticipated = anticipatedPrize?.anticipatedDrawCode
        ? await this.db.system.lotteryResult.findUnique({
            where: {
              drawCode_drawDate: {
                drawCode: anticipatedPrize.anticipatedDrawCode,
                drawDate: toDate(localDateKey(anticipatedPrize.anticipatedDrawAt ?? raffle.drawAt, LOTTERY_TZ)),
              },
            },
          })
        : null;
      const usable = (r: LotteryResult | null) => (r && r.status !== 'disputed' && r.winningNumber ? r : null);
      const primary = usable(main) ?? usable(anticipated);
      if (!primary) continue;
      await this.alerts.lotteryResult(raffle.organizationId, raffle.id, primary, primary === usable(main) ? usable(anticipated) : null);
    }
  }

  /**
   * lottery-poll (respaldo de los webhooks): consulta una vez por fecha los días con sorteos
   * que ya jugaron y todavía no tienen el resultado verificado. Una consulta por día trae
   * todas las loterías, así que el consumo de cuota es mínimo.
   */
  async poll(now = new Date()): Promise<{ dates: string[]; changed: number }> {
    const since = new Date(now.getTime() - 3 * 86_400_000);
    const raffles = await this.db.system.raffle.findMany({
      where: {
        deletedAt: null,
        status: { in: [...LIVE] },
        resultsPublishedAt: null,
        drawAt: { gte: since, lte: new Date(now.getTime() + 86_400_000) },
        OR: [{ lotteryDrawCode: { not: null } }, { prizes: { some: { anticipatedDrawCode: { not: null } } } }],
      },
      include: { prizes: true },
    });
    const wanted = new Map<string, Set<string>>(); // fecha → códigos
    const want = (code: string | null, at: Date) => {
      if (!code || at > now) return; // todavía no ha jugado
      const ymd = localDateKey(at, LOTTERY_TZ);
      wanted.set(ymd, (wanted.get(ymd) ?? new Set()).add(code));
    };
    for (const r of raffles) {
      want(r.lotteryDrawCode, r.drawAt);
      for (const p of r.prizes) want(p.anticipatedDrawCode, p.anticipatedDrawAt ?? r.drawAt);
    }
    const dates: string[] = [];
    let changed = 0;
    for (const [ymd, codes] of wanted) {
      const have = await this.db.system.lotteryResult.findMany({ where: { drawDate: toDate(ymd), drawCode: { in: [...codes] }, status: 'confirmed' } });
      if (have.length === codes.size) continue;
      dates.push(ymd);
      try {
        changed += (await this.ingest(await this.provider.resultsByDate(ymd))).length;
      } catch (err) {
        this.logger.warn(`No se pudo consultar LoteríaYa para ${ymd}: ${String(err)}`);
      }
    }
    return { dates, changed };
  }
}
