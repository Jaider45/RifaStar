import logoBlanco from '@/assets/brand/logo-horizontal-blanco.svg';
import logoNegro from '@/assets/brand/logo-horizontal-negro.svg';
import mark from '@/assets/brand/mark.svg';

interface LogoProps {
  /** "blanco" sobre fondo oscuro, "negro" sobre fondo claro, "mark" para el ícono solo. */
  variante: 'blanco' | 'negro' | 'mark';
  className?: string;
  height?: number;
  decorativo?: boolean;
}

const src = { blanco: logoBlanco, negro: logoNegro, mark };

export function Logo({ variante, className, height, decorativo }: LogoProps) {
  return (
    <img
      src={src[variante]}
      alt={decorativo ? '' : 'Rifa Star'}
      className={className}
      style={height ? { height, width: 'auto' } : undefined}
    />
  );
}
