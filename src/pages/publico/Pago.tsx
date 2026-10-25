import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Icon } from '@/components/Icon';
import { PubFrame } from '@/components/PubFrame';
import { APARTADO_HASTA, ORGANIZACION, SORTEO } from '@/data/mock';
import { cop, pad } from '@/lib/format';
import { useCountdown } from '@/lib/useCountdown';
import './publico.css';

const MEDIOS = [
  { id: 'breb', nombre: 'Llave Bre-B', etiqueta: 'Llave', valor: SORTEO.pago.llave },
  { id: 'nequi', nombre: 'Nequi', etiqueta: 'Número Nequi', valor: SORTEO.pago.nequi.replace(/\s/g, '') },
];

function BotonCopiar({ texto }: { texto: string }) {
  const [copiado, setCopiado] = useState(false);
  return (
    <button
      type="button"
      className="rs-btn rs-btn--secundario rs-btn--sm"
      onClick={() => {
        navigator.clipboard?.writeText(texto);
        setCopiado(true);
        window.setTimeout(() => setCopiado(false), 1600);
      }}
    >
      <Icon name={copiado ? 'check' : 'copy'} size={16} />
      {copiado ? 'Copiado' : 'Copiar'}
    </button>
  );
}

export default function Pago() {
  const location = useLocation();
  const numeros: number[] = (location.state as { numeros?: number[] } | null)?.numeros ?? [7, 24];
  const [medio, setMedio] = useState(MEDIOS[0].id);
  const [archivo, setArchivo] = useState<string | null>(null);
  const r = useCountdown(APARTADO_HASTA);

  const total = numeros.length * SORTEO.precio;
  const m = MEDIOS.find((x) => x.id === medio) ?? MEDIOS[0];
  const primerNombre = ORGANIZACION.propietaria.split(' ')[0];

  return (
    <PubFrame>
      <header className="pub-header pub-header--bar">
        <Link to={`/s/${SORTEO.slug}`} className="rs-btn rs-btn--secundario rs-btn--sm icon-btn" aria-label="Volver a los números">
          <Icon name="arrowLeft" strokeWidth={2.2} />
        </Link>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="header-titulo">Pagar mis números</div>
          <div className="header-sub">{SORTEO.titulo}</div>
        </div>
      </header>

      <main className="pub-main">
        <ol aria-label="Pasos de compra" className="pasos-compra">
          <li>1 · Números</li>
          <li>2 · Tus datos</li>
          <li aria-current="step">3 · Pago</li>
        </ol>

        <div className="note note--alerta" role="status">
          <Icon name="timer" strokeWidth={2.2} style={{ flex: 'none' }} />
          <span>
            Tus números están apartados por <b className="rs-mono">{pad(r.minutos)}:{pad(r.segundos)}</b>. Paga y sube el comprobante antes de que se liberen.
          </span>
        </div>

        <section className="rs-card resumen-pago">
          <div className="fila-sb">
            <span style={{ font: '700 15px/20px var(--font-sans)' }}>Tus números</span>
            <Link to={`/s/${SORTEO.slug}`} className="strong-link">Cambiar</Link>
          </div>
          <div className="chips">
            {numeros.map((n) => (
              <span key={n} className="rs-mono boleto-chip">{pad(n, SORTEO.cifras)}</span>
            ))}
          </div>
          <div className="resumen-pago__total">
            <span>{numeros.length} × {cop(SORTEO.precio)}</span>
            <span className="rs-display">{cop(total)}</span>
          </div>
        </section>

        <section className="stack" style={{ gap: 14 }}>
          <h2 className="h2 h2--sm">Tus datos</h2>
          <div>
            <label className="rs-label" htmlFor="nombre">Nombre completo</label>
            <input id="nombre" className="rs-in fill-in" defaultValue="Laura Martínez" autoComplete="name" />
          </div>
          <div>
            <label className="rs-label" htmlFor="wa">WhatsApp</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <span className="rs-in rs-mono fill-in" style={{ width: 76, flex: 'none', display: 'flex', alignItems: 'center' }}>+57</span>
              <input id="wa" className="rs-in rs-mono fill-in" defaultValue="300 412 7781" inputMode="tel" autoComplete="tel-national" />
            </div>
            <p className="rs-help">Aquí te llega la confirmación y tu boleto.</p>
          </div>
        </section>

        <section className="stack" style={{ gap: 14 }}>
          <h2 className="h2 h2--sm">Paga {cop(total)}</h2>
          <div role="tablist" aria-label="Medio de pago" className="segmento">
            {MEDIOS.map((x) => (
              <button key={x.id} type="button" role="tab" aria-selected={medio === x.id} className="rs-btn rs-btn--sm" onClick={() => setMedio(x.id)}>
                {x.nombre}
              </button>
            ))}
          </div>
          <div className="rs-card list-card" role="tabpanel" aria-label={m.nombre}>
            <div className="list-row">
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="dato-label">{m.etiqueta}</div>
                <div className="rs-mono dato-mono">{m.valor}</div>
              </div>
              <BotonCopiar texto={m.valor} />
            </div>
            <div className="list-row">
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="dato-label">Titular</div>
                <div className="dato-txt">{SORTEO.pago.titular}</div>
              </div>
            </div>
            <div className="list-row">
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="dato-label">Valor exacto</div>
                <div className="rs-mono dato-mono">{total}</div>
              </div>
              <BotonCopiar texto={String(total)} />
            </div>
          </div>
        </section>

        <section className="stack" style={{ gap: 12 }}>
          <h2 className="h2 h2--sm">Sube el comprobante</h2>
          <label className="subir">
            <Icon name="upload" size={28} style={{ color: 'var(--verde-texto)' }} />
            <span className="subir__t">{archivo ?? 'Toca para subir la captura'}</span>
            <span className="subir__d">{archivo ? 'Toca para cambiarla' : `Imagen o PDF del pago de ${cop(total)}`}</span>
            <input
              type="file"
              accept="image/*,application/pdf"
              className="sr-only"
              onChange={(e) => setArchivo(e.target.files?.[0]?.name ?? null)}
            />
          </label>
          <Link to="/mis-boletos" className="rs-btn rs-btn--primario boton-ancho">Enviar comprobante</Link>
          <p className="texto-pie">{primerNombre} verifica el pago y te confirma por WhatsApp. Suele tardar menos de 15 minutos.</p>
        </section>
      </main>
    </PubFrame>
  );
}
