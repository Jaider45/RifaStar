import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { usePublicQuery } from '@/api/hooks';
import { Icon } from '@/components/Icon';
import { PubFrame } from '@/components/PubFrame';
import { Foto } from '@/components/ui';
import { cop, pad } from '@/lib/format';
import { decodeGrid, type NumberState } from '@/lib/grid';
import { formatDraw } from '@/lib/time';
import { useCountdown } from '@/lib/useCountdown';
import {
  PubError,
  PubFooter,
  PubHeader,
  PubLoading,
  readOrder,
  RedesOrganizador,
  rememberLinkCodes,
  TextoConFormato,
  unidadDe,
  type PublicRaffle,
} from './shared';
import './publico.css';

/** Grilla completa (hasta 10.000), un bloque de 1.000 o el resumen por bloques (5 y 6 cifras). */
interface Grid {
  total: number;
  digits: number;
  status: string;
  encoding: 'bitset-2b' | 'bitset-1b' | 'blocks';
  availableCount: number;
  data?: string;
  offset?: number;
  size?: number;
  blockSize?: number;
  blocks?: number[];
}

const ESTADO: Record<string, string> = {
  active: 'Venta abierta',
  sold_out: 'Agotado',
  closed: 'Venta cerrada',
  drawn: 'Sorteo jugado',
  cancelled: 'Cancelado',
};

/** Casillas por página dentro de la grilla o del bloque. */
const PAGINA = 200;
/** Arriba de esto la grilla se consulta por bloques de 1.000. */
const GRID_MAX = 10_000;
const BLOQUE = 1_000;

export default function Venta() {
  const { org = '', sorteo = '' } = useParams();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  useEffect(() => rememberLinkCodes(org, search), [org, search]);
  const q = usePublicQuery<PublicRaffle>(`/v1/public/orgs/${org}/raffles/${sorteo}`);
  const grande = (q.data?.raffle.totalNumbers ?? 0) > GRID_MAX;
  const alAzar = q.data?.raffle.numberSelection === 'random';
  const [bloque, setBloque] = useState(0);
  const base = `/v1/public/orgs/${org}/raffles/${sorteo}/numbers`;
  // Al azar no se necesita la grilla; en sorteos grandes, el resumen y el bloque abierto.
  const resumen = usePublicQuery<Grid>(q.data && grande ? base : null, { refetchInterval: 30_000 });
  const grid = usePublicQuery<Grid>(q.data && !alAzar ? (grande ? `${base}?block=${bloque}` : base) : null, { refetchInterval: 15_000 });
  const [sel, setSel] = useState<number[]>([]);
  const [busqueda, setBusqueda] = useState('');
  const [desde, setDesde] = useState(0);
  const [cantidad, setCantidad] = useState(1);
  const [foto, setFoto] = useState(0);
  const r = useCountdown(q.data ? new Date(q.data.raffle.drawAt).getTime() : Date.now());

  const offset = grid.data?.offset ?? 0;
  const tamano = grid.data?.size ?? grid.data?.total ?? 0;
  const estados = useMemo<NumberState[]>(() => (grid.data?.data ? decodeGrid(grid.data.data, tamano) : []), [grid.data, tamano]);
  const estadoDe = (n: number): NumberState | undefined => estados[n - offset];
  // Si alguien más apartó un número que tenía elegido (en el bloque visible), se quita de la selección.
  useEffect(() => {
    if (estados.length) setSel((cur) => cur.filter((n) => n < offset || n >= offset + tamano || estados[n - offset] === 'available'));
  }, [estados, offset, tamano]);
  useEffect(() => {
    if (q.data) setCantidad((c) => Math.max(c, q.data!.raffle.minPerOrder));
  }, [q.data]);

  if (q.isLoading) return <PubLoading />;
  if (q.error || !q.data) return <PubError error={q.error} />;
  const { raffle, organization, prizes, progress } = q.data;
  if (raffle.status === 'drawn' && raffle.resultsPublished) return <Navigate to={`/${org}/${sorteo}/resultado`} replace />;

  const page = raffle.page;
  const u = unidadDe(raffle);
  const tz = organization.timezone;
  const cifras = raffle.digits;
  const enVenta = raffle.status === 'active' && (!raffle.salesCloseAt || new Date(raffle.salesCloseAt) > new Date());
  const libres = resumen.data?.availableCount ?? grid.data?.availableCount ?? progress.available;
  const vendidosPct = Math.round((progress.paid / raffle.totalNumbers) * 100);
  const fotos = [raffle.coverUrl, ...raffle.gallery].filter((u): u is string => Boolean(u));
  const ordenados = [...sel].sort((a, b) => a - b);
  const pendiente = readOrder(org, sorteo);
  const faltanMinimo = Math.max(0, raffle.minPerOrder - sel.length);

  // Números visibles: grilla chica completa, o el bloque abierto (con buscador y páginas de 200).
  const rango = Array.from({ length: tamano }, (_, i) => offset + i);
  const filtrados = busqueda && !grande ? rango.filter((i) => pad(i, cifras).includes(busqueda)) : rango;
  const visibles = busqueda && !grande ? filtrados.slice(0, PAGINA) : filtrados.slice(desde, desde + PAGINA);

  const toggle = (n: number) => setSel((cur) => (cur.includes(n) ? cur.filter((x) => x !== n) : [...cur, n]));
  const azar = () => {
    const opciones = rango.filter((n) => estadoDe(n) === 'available' && !sel.includes(n));
    if (opciones.length) setSel((cur) => [...cur, opciones[Math.floor(Math.random() * opciones.length)]]);
  };
  /** En sorteos grandes la búsqueda es exacta: abre el bloque del número y lo resalta. */
  const buscarGrande = (txt: string) => {
    setBusqueda(txt);
    if (txt.length === cifras) {
      const n = Number(txt);
      setBloque(Math.floor(n / BLOQUE));
      setDesde(Math.floor((n % BLOQUE) / PAGINA) * PAGINA);
    }
  };
  const buscado = grande && busqueda.length === cifras ? Number(busqueda) : null;

  const reloj = [
    { v: r.dias, l: 'DÍAS' },
    { v: r.horas, l: 'HORAS' },
    { v: r.minutos, l: 'MIN' },
    { v: r.segundos, l: 'SEG' },
  ];

  return (
    <PubFrame acento={raffle.accentColor} tema={page.theme}>
      <PubHeader org={organization} tema={page.theme} />

      <div className="portada">
        <Foto
          src={fotos[foto] ?? fotos[0]}
          alt={raffle.title}
          className="rs-foto portada__foto"
          style={{ objectFit: 'cover' }}
          fallback={
            <div className="rs-foto portada__foto">
              <Icon name="image" size={28} strokeWidth={1.8} />
            </div>
          }
        />
        <span className="rs-badge portada__badge">{ESTADO[raffle.status] ?? raffle.status}</span>
        {fotos.length > 1 && (
          <div className="galeria" role="tablist" aria-label="Fotos del premio">
            {fotos.map((u, i) => (
              <button key={u} type="button" role="tab" aria-selected={i === foto} className="galeria__mini" onClick={() => setFoto(i)} aria-label={`Foto ${i + 1}`}>
                <Foto src={u} alt="" />
              </button>
            ))}
          </div>
        )}
      </div>

      <main className="pub-main venta">
        {pendiente && (
          <Link to={`/${org}/${sorteo}/pagar`} className="note note--alerta" style={{ textDecoration: 'none' }}>
            <Icon name="timer" strokeWidth={2.2} style={{ flex: 'none' }} />
            <span>Tienes {u.p} apartad{u.o}s en este sorteo. Toca aquí para terminar el pago.</span>
          </Link>
        )}

        <section className="stack" style={{ gap: 10 }}>
          <h1 className="pub-title" style={{ fontSize: 32, lineHeight: '34px' }}>{raffle.title}</h1>
          <p className="venta__meta">
            <Icon name="calendar" size={16} />
            {raffle.lottery} · {formatDraw(raffle.drawAt, tz)}
          </p>
        </section>

        <section className={page.show.organizer ? 'venta__duo' : 'stack'}>
          <div className="venta__precio">
            <span className="venta__eyebrow">Cada {u.s}</span>
            <span className="rs-display venta__precio-valor">{cop(raffle.pricePerNumber)}</span>
          </div>
          {page.show.organizer && (
            <Link to={`/${org}`} className="rs-card venta__org" style={{ textDecoration: 'none', color: 'inherit' }}>
              <span className="eyebrow">Organiza</span>
              <span className="venta__org-nombre">{organization.name}</span>
              <span className="venta__verificada">
                <Icon name="check" size={14} strokeWidth={2.6} />
                {organization.rafflesCompleted} sorteos realizados
              </span>
            </Link>
          )}
        </section>

        {page.description && (
          <section className="rs-card venta__descripcion">
            <TextoConFormato texto={page.description} />
          </section>
        )}

        {(page.show.countdown || page.show.progress) && (
          <section className="rs-card venta__reloj">
            {page.show.countdown && (
              <>
                <div className="fila-sb">
                  <span style={{ font: '700 14px/20px var(--font-sans)' }}>El sorteo juega en</span>
                  {page.show.remaining && <span className="rs-badge rs-badge--urgente">Quedan {libres.toLocaleString('es-CO')}</span>}
                </div>
                <div className="contador" aria-label={`Faltan ${r.dias} días, ${r.horas} horas, ${r.minutos} minutos y ${r.segundos} segundos`}>
                  {reloj.map((c) => (
                    <div key={c.l} className="contador__celda" aria-hidden="true">
                      <b className="rs-mono">{pad(c.v)}</b>
                      <small>{c.l}</small>
                    </div>
                  ))}
                </div>
              </>
            )}
            {page.show.progress && (
              <div>
                <div className="rs-progreso" role="progressbar" aria-valuenow={vendidosPct} aria-valuemin={0} aria-valuemax={100} aria-label="Números vendidos">
                  <span style={{ width: `${vendidosPct}%` }} />
                </div>
                <div className="venta__progreso-txt">
                  <span><b>{progress.paid.toLocaleString('es-CO')}</b> de {raffle.totalNumbers.toLocaleString('es-CO')} vendidos</span>
                  <span>{vendidosPct}%</span>
                </div>
              </div>
            )}
          </section>
        )}

        <section className="stack" style={{ gap: 12 }}>
          <h2 className="h2" style={{ lineHeight: '26px' }}>Premios</h2>
          <div className="rs-card list-card">
            {prizes.map((p, i) => (
              <div key={p.position} className="list-row venta__premio">
                <Foto src={p.imageUrl ?? undefined} alt="" className="venta__premio-foto" />
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

        {enVenta && alAzar && (
          <section className="rs-card venta__azar stack" style={{ gap: 14 }}>
            <h2 className="h2" style={{ lineHeight: '26px' }}>¿Cuánt{u.o}s {u.p} quieres?</h2>
            <p className="muted" style={{ margin: 0 }}>
              En este sorteo {u.los} {u.p} se asignan al azar. {raffle.minPerOrder > 1 ? `Compra mínima: ${raffle.minPerOrder} ${u.p}.` : ''}
            </p>
            <div className="cantidad" role="group" aria-label="Cantidad de números">
              <button type="button" className="rs-btn rs-btn--secundario icon-btn" aria-label="Uno menos" disabled={cantidad <= 1} onClick={() => setCantidad((c) => Math.max(1, c - 1))}>−</button>
              <span className="rs-display cantidad__valor" aria-live="polite">{cantidad}</span>
              <button type="button" className="rs-btn rs-btn--secundario icon-btn" aria-label="Uno más" disabled={cantidad >= Math.min(500, libres)} onClick={() => setCantidad((c) => Math.min(500, c + 1))}>+</button>
            </div>
            <div className="chips" style={{ justifyContent: 'center' }}>
              {[2, 5, 10, 20].filter((n) => n >= raffle.minPerOrder && n <= libres).map((n) => (
                <button key={n} type="button" className="rs-chip" aria-pressed={cantidad === n} onClick={() => setCantidad(n)}>{n}</button>
              ))}
            </div>
            <button
              type="button"
              className="rs-btn rs-btn--primario acento-btn boton-ancho"
              disabled={cantidad < raffle.minPerOrder || libres === 0}
              onClick={() => navigate(`/${org}/${sorteo}/pagar`, { state: { cantidad } })}
            >
              Comprar {cantidad} {u.n(cantidad)} · {cop(cantidad * raffle.pricePerNumber)}
            </button>
          </section>
        )}

        {enVenta && !alAzar && (
          <>
            <section className="stack" style={{ gap: 12 }}>
              <div className="fila-sb" style={{ alignItems: 'flex-end' }}>
                <h2 className="h2" style={{ lineHeight: '26px' }}>Elige tus {u.p}</h2>
                {page.show.remaining && <span className="venta__libres">{libres.toLocaleString('es-CO')} libres</span>}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <label className="buscar">
                  <span className="sr-only">Buscar número</span>
                  <Icon name="search" size={18} className="buscar__icono" />
                  <input
                    className="rs-in rs-mono fill-in buscar__in"
                    placeholder={grande ? `Tu número (${cifras} cifras)` : 'Buscar'}
                    inputMode="numeric"
                    value={busqueda}
                    onChange={(e) => {
                      const v = e.target.value.replace(/\D/g, '').slice(0, cifras);
                      if (grande) buscarGrande(v);
                      else {
                        setBusqueda(v);
                        setDesde(0);
                      }
                    }}
                  />
                </label>
                <button type="button" className="rs-btn rs-btn--secundario" onClick={azar} disabled={!estados.length}>
                  <Icon name="dice" size={18} />
                  Al azar
                </button>
              </div>

              {grande && resumen.data?.blocks && (
                <label className="stack" style={{ gap: 6 }}>
                  <span className="rs-label" style={{ margin: 0 }}>Bloque de números</span>
                  <select
                    className="rs-in rs-mono fill-in"
                    value={bloque}
                    onChange={(e) => {
                      setBloque(Number(e.target.value));
                      setDesde(0);
                      setBusqueda('');
                    }}
                  >
                    {resumen.data.blocks.map((free, b) => (
                      <option key={b} value={b} disabled={free === 0}>
                        {pad(b * BLOQUE, cifras)}–{pad(b * BLOQUE + BLOQUE - 1, cifras)} · {free === 0 ? 'agotado' : `${free} libres`}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              {buscado !== null && estadoDe(buscado) && (
                <div className={`note ${estadoDe(buscado) === 'available' ? 'note--ok' : 'note--alerta'}`} role="status">
                  <span>
                    El <b className="rs-mono">{pad(buscado, cifras)}</b> {estadoDe(buscado) === 'available' ? 'está libre.' : 'ya no está disponible.'}
                  </span>
                  {estadoDe(buscado) === 'available' && !sel.includes(buscado) && (
                    <button type="button" className="rs-btn rs-btn--primario rs-btn--sm acento-btn" style={{ marginLeft: 'auto' }} onClick={() => toggle(buscado)}>
                      Elegirlo
                    </button>
                  )}
                </div>
              )}

              <div role="group" aria-label={`Números del ${pad(offset, cifras)} al ${pad(offset + tamano - 1, cifras)}`} className={`numeros${cifras >= 5 ? ' numeros--anchos' : ''}`}>
                {visibles.map((i) => {
                  const txt = pad(i, cifras);
                  const st = estadoDe(i);
                  const ocupado = st && st !== 'available';
                  const elegido = sel.includes(i);
                  return (
                    <button
                      key={i}
                      type="button"
                      className={`rs-num${buscado === i ? ' rs-num--buscado' : ''}`}
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
              {filtrados.length > PAGINA && !(busqueda && !grande) && (
                <div className="fila-sb">
                  <button type="button" className="rs-btn rs-btn--secundario rs-btn--sm" disabled={desde === 0} onClick={() => setDesde((d) => Math.max(0, d - PAGINA))}>Anteriores</button>
                  <span className="muted rs-mono">{pad(offset + desde, cifras)}–{pad(offset + Math.min(desde + PAGINA, tamano) - 1, cifras)}</span>
                  <button type="button" className="rs-btn rs-btn--secundario rs-btn--sm" disabled={desde + PAGINA >= tamano} onClick={() => setDesde((d) => d + PAGINA)}>Siguientes</button>
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
                    ? raffle.minPerOrder > 1 ? `Elige al menos ${raffle.minPerOrder} ${u.p}` : `Aún no eliges ${u.p}`
                    : `${sel.length} ${u.n(sel.length)}: ${ordenados.map((n) => pad(n, cifras)).join(', ')}`}
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
        )}

        {!enVenta && (
          <section className="rs-card agotado">
            <h2 className="pub-title" style={{ fontSize: 22, lineHeight: '26px' }}>
              {raffle.status === 'sold_out' ? `¡Se vendieron tod${u.o}s ${u.los} ${u.p}!` : raffle.status === 'cancelled' ? 'Este sorteo fue cancelado' : 'La venta de este sorteo cerró'}
            </h2>
            <Link to={`/${org}/${sorteo}/resultado`} className="rs-btn rs-btn--secundario">Ver resultado y próximo sorteo</Link>
          </section>
        )}

        {page.faq.length > 0 && (
          <section className="stack" style={{ gap: 10 }}>
            <h2 className="h2" style={{ lineHeight: '26px' }}>Preguntas frecuentes</h2>
            <div className="rs-card list-card">
              {page.faq.map((f, i) => (
                <details key={i} className="faq">
                  <summary>
                    {f.q}
                    <Icon name="chevronDown" size={18} />
                  </summary>
                  <p>{f.a}</p>
                </details>
              ))}
            </div>
          </section>
        )}

        {(page.show.social || page.show.ranking) && (
          <section className="stack" style={{ gap: 10, alignItems: 'center' }}>
            {page.show.social && <RedesOrganizador social={organization.social} />}
            {page.show.ranking && organization.rankingEnabled && (
              <Link to={`/${org}/ranking`} className="strong-link">Ver el ranking del mes</Link>
            )}
          </section>
        )}
      </main>

      <PubFooter show={organization.showRifaStarBadge} />
    </PubFrame>
  );
}
