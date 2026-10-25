import type { CSSProperties, ReactNode } from 'react';

export type BadgeTono = 'vivo' | 'urgente' | 'abierto' | 'ganador' | 'cerrado';

interface BadgeProps {
  tono: BadgeTono;
  children: ReactNode;
  style?: CSSProperties;
}

/** Insignia de estado (`rs-badge`). Siempre con palabra: verde y rojo nunca se distinguen sólo por color. */
export function Badge({ tono, children, style }: BadgeProps) {
  return (
    <span className={`rs-badge rs-badge--${tono}`} style={style}>
      {children}
    </span>
  );
}
