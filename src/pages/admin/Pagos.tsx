import { useState } from 'react';
import { Icon } from '@/components/Icon';
import { PageHeader } from '@/components/PageHeader';
import { SORTEO } from '@/data/mock';
import { usePagos } from '@/data/PagosContext';
import { cop } from '@/lib/format';
import './Pagos.css';

export default function Pagos() {
  const { pendientes, resolver } = usePagos();
  const [actual, setActual] = useState<number | null>(pendientes[0]?.id ?? null);
  const sel = pendientes.find((p) => p.id === actual) ?? pendientes[0];

  const resolverActual = () => {
    if (!sel) return;
    const resto = pendientes.filter((p) => p.id !== sel.id);
    resolver(sel.id);
    setActual(resto[0]?.id ?? null);
  };

  return (
    <>
      <PageHeader
        title="Verificar pagos"
        sub="Compara el comprobante con tu cuenta y aprueba. El participante recibe su boleto por WhatsApp al instante."
        actions={
          <label className="pagos-sorteo">
            <span className="rs-label">Sorteo</span>
            <select className="rs-in">
              <option>Gana con Boyacá · 24 oct</option>
              <option>Moto Yamaha NMAX 2027</option>
            </select>
          </label>
        }
      />

      <div className="split">
        <section aria-label="Pagos pendientes" className="rs-panel pagos-lista">
          <div className="pagos-lista__head">
            <span className="pagos-lista__titulo">Pendientes · {pendientes.length}</span>
            <span className="pagos-lista__orden">Más antiguos primero</span>
          </div>
          {pendientes.length === 0 && <div className="pagos-vacio">No hay pagos por verificar.</div>}
          {pendientes.map((p) => (
            <button
              key={p.id}
              type="button"
              className="pago-item"
              aria-pressed={p.id === sel?.id}
              onClick={() => setActual(p.id)}
            >
              <div className="pago-item__info">
                <div className="pago-item__nombre">{p.nombre}</div>
                <div className="pago-item__meta">
                  {p.nums.length === 1 ? 'Número' : 'Números'} {p.nums.join(', ')} · hace {p.hace}
                </div>
              </div>
              <span className="rs-mono pago-item__monto">{cop(p.nums.length * SORTEO.precio)}</span>
            </button>
          ))}
        </section>

        <section aria-label="Detalle del pago" className="rs-panel pago-detalle">
          <div className="rs-foto pago-detalle__captura">
            <Icon name="receipt" size={28} strokeWidth={1.8} />
            [Captura del comprobante]
            <button type="button" className="rs-btn rs-btn--secundario rs-btn--sm">Ampliar</button>
          </div>
          <div className="pago-detalle__datos">
            <div>
              <div className="pago-detalle__label">Participante</div>
              <div className="rs-display pago-detalle__nombre">{sel?.nombre ?? '—'}</div>
              {sel && (
                <a href={`https://wa.me/${sel.wa.replace(/\D/g, '')}`} className="strong-link" target="_blank" rel="noreferrer">
                  {sel.wa}
                </a>
              )}
            </div>
            <div className="chips">
              {sel?.nums.map((n) => (
                <span key={n} className="rs-mono pago-detalle__num">{n}</span>
              ))}
            </div>
            <dl className="pago-detalle__dl">
              <dt>Debe pagar</dt>
              <dd className="rs-mono" style={{ fontWeight: 700 }}>{cop((sel?.nums.length ?? 0) * SORTEO.precio)}</dd>
              <dt>Medio</dt>
              <dd>Llave Bre-B · {SORTEO.pago.llave}</dd>
              <dt>Enviado</dt>
              <dd>hoy, hace {sel?.hace ?? '—'}</dd>
              <dt>Apartado hasta</dt>
              <dd>{sel?.vence ?? '—'}</dd>
            </dl>
            <div className="note note--ok">Revisa que el valor y la hora coincidan con el movimiento en tu cuenta.</div>
            <div className="pago-detalle__acciones">
              <button type="button" className="rs-btn rs-btn--primario" style={{ flex: '1 1 160px' }} onClick={resolverActual} disabled={!sel}>
                <Icon name="check" size={18} strokeWidth={2.6} />
                Aprobar pago
              </button>
              <button
                type="button"
                className="rs-btn rs-btn--secundario"
                style={{ flex: '1 1 120px', color: 'var(--rojo-texto)' }}
                onClick={resolverActual}
                disabled={!sel}
              >
                Rechazar
              </button>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
