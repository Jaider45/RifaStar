import { useEffect, useRef, useState, type ImgHTMLAttributes, type ReactNode } from 'react';
import { errorMessage } from '@/api/client';
import { Icon } from './Icon';

/**
 * Imagen del almacenamiento. Si no carga (enlace vencido, archivo borrado, sin conexión)
 * muestra `fallback` (por defecto nada) en vez del ícono de imagen rota del navegador.
 */
export function Foto({ src, fallback = null, ...rest }: ImgHTMLAttributes<HTMLImageElement> & { fallback?: ReactNode }) {
  const [rota, setRota] = useState(false);
  useEffect(() => setRota(false), [src]);
  if (!src || rota) return <>{fallback}</>;
  return <img src={src} {...rest} onError={() => setRota(true)} />;
}

/** Aviso de error en español a partir de cualquier error de la API. */
export function ErrorNote({ error, style }: { error: unknown; style?: React.CSSProperties }) {
  if (!error) return null;
  return (
    <div className="note note--alerta" role="alert" style={style}>
      <Icon name="info" size={18} style={{ flex: 'none' }} />
      <span>{errorMessage(error)}</span>
    </div>
  );
}

export function OkNote({ children }: { children: ReactNode }) {
  return (
    <div className="note note--ok" role="status">
      <Icon name="check" size={18} strokeWidth={2.6} style={{ flex: 'none' }} />
      <span>{children}</span>
    </div>
  );
}

export function Loading({ label = 'Cargando…' }: { label?: string }) {
  return (
    <div className="cargando" role="status" aria-live="polite">
      <span className="cargando__punto" aria-hidden="true" />
      {label}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="muted" style={{ textAlign: 'center', padding: 40, font: '600 15px/22px var(--font-sans)' }}>{children}</div>;
}

/** Diálogo modal accesible (cierra con Esc o con el fondo). */
export function Modal({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    ref.current?.querySelector<HTMLElement>('input, select, textarea, button')?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className="rs-panel modal__caja" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal__head">
          <h2 className="h2 h2--sm">{title}</h2>
          <button type="button" className="rs-btn rs-btn--fantasma rs-btn--sm" aria-label="Cerrar" onClick={onClose}>✕</button>
        </div>
        <div className="modal__body">{children}</div>
        {footer && <div className="modal__foot">{footer}</div>}
      </div>
    </div>
  );
}

/** Copia texto y muestra «Copiado» un momento. */
export async function copy(text: string): Promise<void> {
  try {
    await navigator.clipboard?.writeText(text);
  } catch {
    /* sin permiso de portapapeles */
  }
}
