import type { CSSProperties, ReactNode } from 'react';
import { acentoPorColor } from '@/lib/acentos';

interface PubFrameProps {
  children: ReactNode;
  /** Color del sorteo (hex): pinta precio, selección de números y botón principal. */
  acento?: string | null;
}

/** Marco de los enlaces públicos: tema oscuro, columna móvil centrada. */
export function PubFrame({ children, acento }: PubFrameProps) {
  const a = acento ? acentoPorColor(acento) : null;
  const style = a ? ({ '--acento': a.color, '--on-acento': a.on } as CSSProperties) : undefined;
  return (
    <div className="rs-oscuro pub" style={style}>
      <div className="pub__frame">{children}</div>
    </div>
  );
}
