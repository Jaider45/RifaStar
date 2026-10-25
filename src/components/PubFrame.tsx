import type { CSSProperties, ReactNode } from 'react';
import { ACENTOS, type Acento } from '@/data/mock';

interface PubFrameProps {
  children: ReactNode;
  /** Color del sorteo: pinta precio, selección de números y botón principal. */
  acento?: Acento['id'];
}

/** Marco de los enlaces públicos: tema oscuro, columna móvil centrada. */
export function PubFrame({ children, acento }: PubFrameProps) {
  const a = ACENTOS.find((x) => x.id === acento);
  const style = a ? ({ '--acento': a.color, '--on-acento': a.on } as CSSProperties) : undefined;
  return (
    <div className="rs-oscuro pub" style={style}>
      <div className="pub__frame">{children}</div>
    </div>
  );
}
