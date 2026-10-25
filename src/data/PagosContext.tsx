import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { PAGOS_PENDIENTES, type PagoPendiente } from './mock';

interface PagosState {
  pendientes: PagoPendiente[];
  /** Aprueba o rechaza: en ambos casos sale de la cola de verificación. */
  resolver: (id: number) => void;
}

const PagosContext = createContext<PagosState | null>(null);

export function PagosProvider({ children }: { children: ReactNode }) {
  const [pendientes, setPendientes] = useState(PAGOS_PENDIENTES);
  const value = useMemo<PagosState>(
    () => ({
      pendientes,
      resolver: (id) => setPendientes((cur) => cur.filter((p) => p.id !== id)),
    }),
    [pendientes],
  );
  return <PagosContext.Provider value={value}>{children}</PagosContext.Provider>;
}

export function usePagos(): PagosState {
  const ctx = useContext(PagosContext);
  if (!ctx) throw new Error('usePagos debe usarse dentro de <PagosProvider>');
  return ctx;
}
