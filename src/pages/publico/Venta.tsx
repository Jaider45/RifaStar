import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { usePublicQuery } from '@/api/hooks';
import { Icon } from '@/components/Icon';
import { PubFrame } from '@/components/PubFrame';
import { cop, pad } from '@/lib/format';
import { decodeGrid } from '@/lib/grid';
import { formatDraw } from '@/lib/time';
import { useCountdown } from '@/lib/useCountdown';
import { PubError, PubFooter, PubHeader, PubLoading, readOrder, rememberLinkCodes, type PublicRaffle } from './shared';
import './publico.css';

interface Grid { total: number; digits: number; status: string; encoding: string; availableCount: number; data: string }

const ESTADO: Record<string, string> = {
  active: 'Venta abierta',
  sold_out: 'Agotado',
  closed: 'Venta cerrada',
  drawn: 'Sorteo jugado',
  cancelled: 'Cancelado',
};

/** Muestra hasta este número de casillas en sorteos grandes (el resto con el buscador). */
const PAGINA = 200;

export default function Venta() {
  const { org = '', sorteo = '' } = useParams();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  useEffect(() => rememberLinkCodes(org, search), [org, search]);
  const q = usePublicQuery<PublicRaffle>(`/v1/public/orgs/${org}/raffles/${sorteo}`);
  const grid = usePublicQuery<Grid>(`/v1/public/orgs/${org}/raffles/${sorteo}/numbers`, { refetchInterval: 15_000 });
  const [sel, setSel] = useState<number[]>([]);
  const [busqueda, setBusqueda] = useState('');
  const [desde, setDesde] = useState(0);
  const r = useCountdown(q.data ? new Date(q.data.raffle.drawAt).getTime() : Date.now());

  const estados = useMemo(() => (grid.data ? decodeGrid(grid.data.data, grid.data.total) : []), [grid.data]);
  // Si alguien más apartó un número que tenía elegido, se quita de la selección.
  useEffect(() => {
    if (estados.length) setSel((cur) => cur.filter((n) => estados[n] === 'available'));
  }, [estados]);

  if (q.isLoading) return <PubLoading />;
  if (q.error || !q.data) return <PubError error={q.error} />;
  const { raffle, organization, prizes, progress } = q.data;
  if (raffle.status === 'drawn' && raffle.resultsPublished) return <Navigate to={`/${org}/${sorteo}/resultado`} replace />;

  const tz = organization.timezone;
  const cifras = raffle.digits;
  const enVenta = raffle.status === 'active' && (!raffle.salesCloseAt || new Date(raffle.salesCloseAt) > new Date());
  const libres = grid.data?.availableCount ?? progress.available;
  const vendidosPct = Math.round((progress.paid / raffle.totalNumbers) * 100);
  const filtrados = Array.from({ length: raffle.totalNumbers }, (_, i) => i).filter((i) => !busqueda || pad(i, cifras).includes(busqueda));
  const visibles = raffle.totalNumbers > PAGINA && !busqueda ? filtrados.slice(desde, desde + PAGINA) : filtrados.slice(0, PAGINA);
  const ordenados = [...sel].sort((a, b) => a - b);
  const pendiente = readOrder(org, sorteo);

  const toggle = (n: number) => setSel((cur) => (cur.includes(n) ? cur.filter((x) => x !== n) : [...cur, n]));
  const azar = () => {
    const opciones = estados.map((s, i) => (s === 'available' && !sel.includes(i) ? i : -1)).filter((i) => i >= 0);
    if (opciones.length) setSel((cur) => [...cur, opciones[Math.floor(Math.random() * opciones.length)]]);
  };
  const reloj = [
    { v: r.dias, l: 'DÍAS' },
    { v: r.horas, l: 'HORAS' },
    { v: r.minutos, l: 'MIN' },
    { v: r.segundos, l: 'SEG' },
  ];
  const faltanMinimo = Math.max(0, raffle.minPerOrder - sel.length);

  return (
    <PubFrame acento={raffle.accentColor}>
      <PubHeader org={organization} />

      <div className="portada">
        {raffle.coverUrl ? (
          <img src={raffle.coverUrl} alt={raffle.title} className="rs-foto portada__foto" style={{ objectFit: 'cover' }} />
        ) : (
          <div className="rs-foto portada__foto">
            <Icon name="image" size={28} strokeWidth={1.8} />
          </div>
        )}
        <span className="rs-badge portada__badge">{ESTADO[raffle.status] ?? raffle.status}</span>
      </div>

      <main className="pub-main venta">
        {pendiente && (
          <Link to={`/${org}/${sorteo}/pagar`} className="note note--alerta" style={{ textDecoration: 'none' }}>
            <Icon name="timer" strokeWidth={2.2} style={{ flex: 'none' }} />
            <span>Tienes números apartados en este sorteo. Toca aquí para terminar el pago.</span>
          </Link>
        )}

        <section className="stack" style={{ gap: 10 }}>
          <h1 className="pub-title" style={{ fontSize: 32, lineHeight: '34px' }}>{raffle.title}</h1>
          <p className="venta__meta">
            <Icon name="calendar" size={16} />
            {raffle.lottery} · {formatDraw(raffle.drawAt, tz)}
          </p>
        </section>

        <section className="venta__duo">
          <div className="venta__precio">
            <span className="venta__eyebrow">Cada número</span>
            <span className="rs-display venta__precio-valor">{cop(raffle.pricePerNumber)}</span>
          </div>
          <Link to={`/${org}`} className="rs-card venta__org" style={{ textDecoration: 'none', color: 'inherit' }}>
            <span className="eyebrow">Organiza</span>
            <span className="venta__org-nombre">{organization.name}</span>
            <span className="venta__verificada">
              <Icon name="check" size={14} strokeWidth={2.6} />
              {organization.rafflesCompleted} sorteos realizados
            </span>
          </Link>
        </section>

        <section className="rs-card venta__reloj">
          <div className="fila-sb">
            <span style={{ font: '700 14px/20px var(--font-sans)' }}>El sorteo juega en</span>
            <span className="rs-badge rs-badge--urgente">Quedan {libres}</span>
          </div>
          <div className="contador" aria-label={`Faltan ${r.dias} días, ${r.horas} horas, ${r.minutos} minutos y ${r.segundos} segundos`}>
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
              <span><b>{progress.paid}</b> de {raffle.totalNumbers.toLocaleString('es-CO')} vendidos</span>
              <span>{vendidosPct}%</span>
            </div>
          </div>
        </section>

        <section className="stack" style={{ gap: 12 }}>
          <h2 className="h2" style={{ lineHeight: '26px' }}>Premios</h2>
          <div className="rs-card list-card">
            {prizes.map((p, i) => (
              <div key={p.position} className="list-row venta__premio">
                <span className={`rs-display venta__premio-monto${i === 0 ? ' venta__premio-monto--mayor' : ''}`}>{p.amountCop ? cop(p.amountCop) : p.description}</span>
                <span className="venta__premio-regla">{p.ruleLabel}</span>
              </div>
            ))}
          </div>
          {raffle.conditionText && (
            <p className="info-line">
              <Icon name="info" size={16} />
              {raffle.conditionText}
            </p>
          )}
          {raffle.authorizationNumber && <p className="texto-pie">Autorización n.º {raffle.authorizationNumber}</p>}
        </section>

        {enVenta ? (
          <>
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
                    onChange={(e) => setBusqueda(e.target.value.replace(/\D/g, '').slice(0, cifras))}
                  />
                </label>
                <button type="button" className="rs-btn rs-btn--secundario" onClick={azar}>
                  <Icon name="dice" size={18} />
                  Al azar
                </button>
              </div>
              <div role="group" aria-label={`Números del ${pad(0, cifras)} al ${pad(raffle.totalNumbers - 1, cifras)}`} className="numeros">
                {visibles.map((i) => {
                  const txt = pad(i, cifras);
                  const ocupado = estados[i] && estados[i] !== 'available';
                  const elegido = sel.includes(i);
                  return (
                    <button
                      key={i}
                      type="button"
                      className="rs-num"
                      aria-pressed={elegido}
                      disabled={!estados.length || ocupado}
                      onClick={() => toggle(i)}
                      aria-label={`Número ${txt}${ocupado ? ', no disponible' : elegido ? ', seleccionado' : ', libre'}`}
                    >
                      {txt}
                    </button>
                  );
                })}
              </div>
              {raffle.totalNumbers > PAGINA && !busqueda && (
                <div className="fila-sb">
                  <button type="button" className="rs-btn rs-btn--secundario rs-btn--sm" disabled={desde === 0} onClick={() => setDesde((d) => Math.max(0, d - PAGINA))}>Anteriores</button>
                  <span className="muted rs-mono">{pad(desde, cifras)}–{pad(Math.min(desde + PAGINA, raffle.totalNumbers) - 1, cifras)}</span>
                  <button type="button" className="rs-btn rs-btn--secundario rs-btn--sm" disabled={desde + PAGINA >= raffle.totalNumbers} onClick={() => setDesde((d) => d + PAGINA)}>Siguientes</button>
                </div>
              )}
              <div className="leyenda">
                <span><i className="leyenda__libre" />Libre</span>
                <span><i className="leyenda__sel" />Tu selección</span>
                <span><i className="leyenda__vendido" />No disponible</span>
              </div>
            </section>

            <section className="resumen-compra">
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="resumen-compra__txt">
                  {sel.length === 0
                    ? raffle.minPerOrder > 1 ? `Elige al menos ${raffle.minPerOrder} números` : 'Aún no eliges números'
                    : `${sel.length} ${sel.length === 1 ? 'número' : 'números'}: ${ordenados.map((n) => pad(n, cifras)).join(', ')}`}
                  {sel.length > 0 && faltanMinimo > 0 && ` · faltan ${faltanMinimo}`}
                </div>
                <div className="rs-display resumen-compra__total">{cop(sel.length * raffle.pricePerNumber)}</div>
              </div>
              <button
                type="button"
                className="rs-btn rs-btn--primario acento-btn"
                disabled={sel.length === 0 || faltanMinimo > 0}
                onClick={() => navigate(`/${org}/${sorteo}/pagar`, { state: { numeros: ordenados } })}
              >
                Continuar al pago
                <Icon name="arrowRight" size={18} strokeWidth={2.4} />
              </button>
            </section>
          </>
        ) : (
          <section className="rs-card agotado">
            <h2 className="pub-title" style={{ fontSize: 22, lineHeight: '26px' }}>
              {raffle.status === 'sold_out' ? '¡Se vendieron todos los números!' : raffle.status === 'cancelled' ? 'Este sorteo fue cancelado' : 'La venta de este sorteo cerró'}
            </h2>
            <Link to={`/${org}/${sorteo}/resultado`} className="rs-btn rs-btn--secundario">Ver resultado y próximo sorteo</Link>
          </section>
        )}
      </main>

      <PubFooter show={organization.showRifaStarBadge} />
    </PubFrame>
  );
}
