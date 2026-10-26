import type { CSSProperties, ReactNode } from 'react';
import { acentoPorColor } from '@/lib/acentos';

interface PubFrameProps {
  children: ReactNode;
  /** Color del sorteo (hex): pinta precio, selección de números y botón principal. */
  acento?: string | null;
  /** Tema elegido por el organizador. Oscuro es la cara de la marca. */
  tema?: 'dark' | 'light';
}

/** Marco de los enlaces públicos: columna móvil centrada, tema oscuro (o claro). */
export function PubFrame({ children, acento, tema = 'dark' }: PubFrameProps) {
  const a = acento ? acentoPorColor(acento) : null;
  const style = a ? ({ '--acento': a.color, '--on-acento': a.on } as CSSProperties) : undefined;
  return (
    <div className={`${tema === 'light' ? 'rs-claro pub--claro' : 'rs-oscuro'} pub`} style={style}>
      <div className="pub__frame">{children}</div>
    </div>
  );
}
