import { Injectable, Logger } from '@nestjs/common';
import type { Tx } from '../database/database.service';

export type OrderEventType = 'approved' | 'rejected' | 'released';

export interface OrderEvent {
  type: OrderEventType;
  organizationId: string;
  orderId: string;
  raffleId: string;
  participantId: string;
  numbers: number[];
  /** Estado previo (para la liberación: si estaba aprobada hay que revertir puntos). */
  previousStatus: string;
  reason?: string | null;
  actorMemberId: string | null;
  at: Date;
}

type TxHandler = (tx: Tx, event: OrderEvent) => Promise<void>;
type CommittedHandler = (event: OrderEvent) => Promise<void>;

/**
 * Puntos de extensión del ciclo de vida de una orden. Los manejadores «en
 * transacción» (p. ej. puntos del ranking) corren dentro de la misma
 * transacción; los «después del commit» (p. ej. WhatsApp) nunca la revierten.
 */
@Injectable()
export class OrderHooks {
  private readonly logger = new Logger(OrderHooks.name);
  private readonly txHandlers: TxHandler[] = [];
  private readonly committedHandlers: CommittedHandler[] = [];

  inTransaction(handler: TxHandler): void {
    this.txHandlers.push(handler);
  }

  afterCommit(handler: CommittedHandler): void {
    this.committedHandlers.push(handler);
  }

  async runInTransaction(tx: Tx, event: OrderEvent): Promise<void> {
    for (const h of this.txHandlers) await h(tx, event);
  }

  async runAfterCommit(event: OrderEvent): Promise<void> {
    for (const h of this.committedHandlers) {
      try {
        await h(event);
      } catch (err) {
        this.logger.error(`Hook posterior a «${event.type}» falló para la orden ${event.orderId}: ${(err as Error).message}`);
      }
    }
  }
}
