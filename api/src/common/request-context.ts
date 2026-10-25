import { AsyncLocalStorage } from 'node:async_hooks';
import type { ActorType } from '@prisma/client';

export interface Actor {
  type: ActorType;
  id: string | null;
  label?: string;
}

export interface RequestContext {
  requestId: string;
  ip?: string;
  userAgent?: string;
  actor?: Actor;
  organizationId?: string;
  supportSessionId?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export const requestContext = {
  run<T>(ctx: RequestContext, fn: () => T): T {
    return storage.run(ctx, fn);
  },
  get(): RequestContext | undefined {
    return storage.getStore();
  },
  /** Completa el contexto actual (lo usan los guards al autenticar). */
  patch(values: Partial<RequestContext>): void {
    const store = storage.getStore();
    if (store) Object.assign(store, values);
  },
};
