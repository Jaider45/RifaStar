import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '@/components/Icon';
import { Logo } from '@/components/Logo';
import { PubFrame } from '@/components/PubFrame';
import { JUEGA_EN, ORGANIZACION, SORTEO } from '@/data/mock';
import { cop, pad } from '@/lib/format';
import { useCountdown } from '@/lib/useCountdown';
import './publico.css';

export default function Venta() {
  const [sel, setSel] = useState<number[]>([7, 24]);
  const [busqueda, setBusqueda] = useState('');
  const r = useCountdown(JUEGA_EN);

  const vendidos = new Set(SORTEO.vendidos);
  const libres = SORTEO.total - vendidos.size;
  const vendidosPct = Math.round((vendidos.size / SORTEO.total) * 100);
  const numeros = Array.from({ length: SORTEO.total }, (_, i) => i).filter((i) => !busqueda || pad(i, SORTEO.cifras).includes(busqueda));
  const ordenados = [...sel].sort((a, b) => a - b);

  const toggle = (n: number) => setSel((cur) => (cur.includes(n) ? cur.filter((x) => x !== n) : [...cur, n]));
  const azar = () => {
    const opciones = Array.from({ length: SORTEO.total }, (_, i) => i).filter((i) => !vendidos.has(i) && !sel.includes(i));
    if (opciones.length) setSel((cur) => [...cur, opciones[Math.floor(Math.random() * opciones.length)]]);
  };

  const reloj = [
    { v: r.dias, l: 'DÍAS' },
    { v: r.horas, l: 'HORAS' },
    { v: r.minutos, l: 'MIN' },
    { v: r.segundos, l: 'SEG' },
  ];

  return (
    <PubFrame acento={SORTEO.acento}>
      <header className="pub-header">
        <Logo variante="blanco" className="pub-header__logo" />
        <div style={{ display: 'flex', gap: 8 }}>
          <a href={`https://wa.me/${ORGANIZACION.whatsapp}`} className="rs-btn rs-btn--secundario rs-btn--sm icon-btn" aria-label="Soporte por WhatsApp">
            <Icon name="whatsappFull" />
          </a>
          <Link to="/mis-boletos" className="rs-btn rs-btn--secundario rs-btn--sm" style={{ minHeight: 44 }}>
            <Icon name="ticket" size={18} />
            Mis boletos
          </Link>
        </div>
      </header>

      <div className="portada">
        <div className="rs-foto portada__foto">
          <Icon name="image" size={28} strokeWidth={1.8} />
          [Foto de portada del sorteo]
        </div>
        <span className="rs-badge portada__badge">Venta abierta</span>
      </div>

      <main className="pub-main venta">
        <section className="stack" style={{ gap: 10 }}>
          <h1 className="pub-title" style={{ fontSize: 32, lineHeight: '32px' }}>
            {SORTEO.tituloLineas[0]}<br />{SORTEO.tituloLineas[1]}
          </h1>
          <p className="venta__meta">
            <Icon name="calendar" size={16} />
            {SORTEO.loteria} · {SORTEO.fechaTexto}
          </p>
        </section>

        <section className="venta__duo">
          <div className="venta__precio">
            <span className="venta__eyebrow">Cada número</span>
            <span className="rs-display venta__precio-valor">{cop(SORTEO.precio)}</span>
          </div>
          <div className="rs-card venta__org">
            <span className="eyebrow">Organiza</span>
            <span className="venta__org-nombre">{ORGANIZACION.propietaria}</span>
            <span className="venta__verificada">
              <Icon name="check" size={14} strokeWidth={2.6} />
              Verificada · {ORGANIZACION.sorteosRealizados} sorteos
            </span>
          </div>
        </section>

        <section className="rs-card venta__reloj">
          <div className="fila-sb">
            <span style={{ font: '700 14px/20px var(--font-sans)' }}>El sorteo juega en</span>
            <span className="rs-badge rs-badge--urgente">Quedan {libres}</span>
          </div>
          <div
            className="contador"
            aria-label={`Faltan ${r.dias} días, ${r.horas} horas, ${r.minutos} minutos y ${r.segundos} segundos`}
          >
            {reloj.map((c) => (
              <div key={c.l} className="contador__celda" aria-hidden="true">
                <b className="rs-mono">{pad(c.v)}</b>
                <small>{c.l}</small>
              </div>
            ))}
          </div>
          <div>
            <div className="rs-progreso" role="progressbar" aria-valuenow={vendidosPct} aria-valuemin={0} aria-valuemax={100} aria-label="Números vendidos">
              <span style={{ width: `${vendidosPct}%` }} />
            </div>
            <div className="venta__progreso-txt">
              <span><b>{vendidos.size}</b> de {SORTEO.total} vendidos</span>
              <span>{vendidosPct}%</span>
            </div>
          </div>
        </section>

        <section className="stack" style={{ gap: 12 }}>
          <h2 className="h2" style={{ lineHeight: '26px' }}>Premios</h2>
          <div className="rs-card list-card">
            {SORTEO.premios.map((p, i) => (
              <div key={p.regla} className="list-row venta__premio">
                <span className={`rs-display venta__premio-monto${i === 0 ? ' venta__premio-monto--mayor' : ''}`}>{cop(p.monto)}</span>
                <span className="venta__premio-regla">{p.reglaCorta ?? p.regla}</span>
              </div>
            ))}
          </div>
          <p className="info-line">
            <Icon name="info" size={16} />
            {SORTEO.condicion}
          </p>
        </section>

        <section className="stack" style={{ gap: 12 }}>
          <div className="fila-sb" style={{ alignItems: 'flex-end' }}>
            <h2 className="h2" style={{ lineHeight: '26px' }}>Elige tus números</h2>
            <span className="venta__libres">{libres} libres</span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <label className="buscar">
              <span className="sr-only">Buscar número</span>
              <Icon name="search" size={18} className="buscar__icono" />
              <input
                className="rs-in rs-mono fill-in buscar__in"
                placeholder="Buscar"
                inputMode="numeric"
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value.replace(/\D/g, '').slice(0, SORTEO.cifras))}
              />
            </label>
            <button type="button" className="rs-btn rs-btn--secundario" onClick={azar}>
              <Icon name="dice" size={18} />
              Al azar
            </button>
          </div>
          <div role="group" aria-label="Números del 00 al 99" className="numeros">
            {numeros.map((i) => {
              const txt = pad(i, SORTEO.cifras);
              const vendido = vendidos.has(i);
              const elegido = sel.includes(i);
              return (
                <button
                  key={i}
                  type="button"
                  className="rs-num"
                  aria-pressed={elegido}
                  disabled={vendido}
                  onClick={() => toggle(i)}
                  aria-label={`Número ${txt}${vendido ? ', vendido' : elegido ? ', seleccionado' : ', libre'}`}
                >
                  {txt}
                </button>
              );
            })}
          </div>
          <div className="leyenda">
            <span><i className="leyenda__libre" />Libre</span>
            <span><i className="leyenda__sel" />Tu selección</span>
            <span><i className="leyenda__vendido" />Vendido</span>
          </div>
        </section>

        <section className="resumen-compra">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="resumen-compra__txt">
              {sel.length === 0
                ? 'Aún no eliges números'
                : `${sel.length} ${sel.length === 1 ? 'número' : 'números'}: ${ordenados.map((n) => pad(n, SORTEO.cifras)).join(', ')}`}
            </div>
            <div className="rs-display resumen-compra__total">{cop(sel.length * SORTEO.precio)}</div>
          </div>
          <Link
            to={`/s/${SORTEO.slug}/pagar`}
            state={{ numeros: ordenados }}
            className="rs-btn rs-btn--primario acento-btn"
            aria-disabled={sel.length === 0}
            onClick={(e) => sel.length === 0 && e.preventDefault()}
          >
            Continuar al pago
            <Icon name="arrowRight" size={18} strokeWidth={2.4} />
          </Link>
        </section>
      </main>

      <footer className="pub-footer">
        <Logo variante="mark" height={18} decorativo />
        Sorteo creado con Rifa Star
      </footer>
    </PubFrame>
  );
}
