import { useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ApiError, request } from '@/api/client';
import { usePublicQuery } from '@/api/hooks';
import { Badge, type BadgeTono } from '@/components/Badge';
import { Icon } from '@/components/Icon';
import { PubFrame } from '@/components/PubFrame';
import { copy, ErrorNote, Loading, OkNote } from '@/components/ui';
import { cop } from '@/lib/format';
import { waLink } from '@/lib/phone';
import { formatDraw, monthLabel } from '@/lib/time';
import { PubFooter, type PublicOrg } from './shared';
import './publico.css';

interface MyTickets {
  participant: { name: string; nickname: string | null; referralCode: string | null };
  raffles: {
    slug: string;
    title: string;
    lottery: string;
    drawAt: string;
    status: string;
    tickets: { code: string; number: string }[];
    pending: { orderId: string; status: string; numbers: string[] }[];
    result: { mainResult: string; anticipatedResult: string | null } | null;
    won: { number: string; prize: number | string | null; delivered: boolean }[];
  }[];
  ranking: { period: string; closesAt: string; rank: number | null; points: number; pointsToTop10: number } | null;
}

const ESTADO: Record<string, { label: string; tono: BadgeTono }> = {
  active: { label: 'En venta', tono: 'abierto' },
  sold_out: { label: 'Agotado', tono: 'vivo' },
  closed: { label: 'Venta cerrada', tono: 'vivo' },
  drawn: { label: 'Sorteado', tono: 'cerrado' },
  cancelled: { label: 'Cancelado', tono: 'cerrado' },
};

const tokenKey = (org: string) => `rs_pt_${org}`;
const readToken = (org: string) => {
  try {
    return sessionStorage.getItem(tokenKey(org));
  } catch {
    return null;
  }
};

/** Acceso con WhatsApp + código de 6 dígitos (OTP) enviado por WhatsApp. */
function Acceso({ org, onToken }: { org: string; onToken: (t: string) => void }) {
  const [wa, setWa] = useState('');
  const [codigo, setCodigo] = useState('');
  const [enviado, setEnviado] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const pedir = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await request<{ message: string }>(`/v1/public/orgs/${org}/my-tickets/otp`, { body: { phone: wa } });
      setEnviado(r.message);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const verificar = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await request<{ token: string }>(`/v1/public/orgs/${org}/my-tickets/verify`, { body: { phone: wa, code: codigo.trim() } });
      try {
        sessionStorage.setItem(tokenKey(org), r.token);
      } catch {
        /* sin almacenamiento: la sesión dura lo que la pestaña */
      }
      onToken(r.token);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  if (!enviado) {
    return (
      <form className="stack" style={{ gap: 10 }} onSubmit={pedir}>
        <label className="rs-label" htmlFor="buscarwa" style={{ margin: 0 }}>Consulta con tu WhatsApp</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input id="buscarwa" className="rs-in rs-mono fill-in" value={wa} onChange={(e) => setWa(e.target.value)} inputMode="tel" autoComplete="tel-national" placeholder="300 412 7781" required />
          <button className="rs-btn rs-btn--primario" type="submit" disabled={busy}>{busy ? 'Enviando…' : 'Buscar'}</button>
        </div>
        <p className="rs-help">Te enviamos un código por WhatsApp para proteger tus boletos.</p>
        <ErrorNote error={error} />
      </form>
    );
  }
  return (
    <form className="stack" style={{ gap: 10 }} onSubmit={verificar}>
      <OkNote>{enviado}</OkNote>
      <label className="rs-label" htmlFor="codigo" style={{ margin: 0 }}>Código de 6 dígitos</label>
      <div style={{ display: 'flex', gap: 8 }}>
        <input id="codigo" className="rs-in rs-mono fill-in" value={codigo} onChange={(e) => setCodigo(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" required pattern="\d{6}" autoFocus />
        <button className="rs-btn rs-btn--primario" type="submit" disabled={busy || codigo.length !== 6}>{busy ? 'Verificando…' : 'Entrar'}</button>
      </div>
      <ErrorNote error={error} />
      <button type="button" className="rs-btn rs-btn--fantasma rs-btn--sm" onClick={() => { setEnviado(null); setCodigo(''); setError(null); }}>Cambiar número</button>
    </form>
  );
}

export default function Boletos() {
  const { org = '' } = useParams();
  const orgInfo = usePublicQuery<PublicOrg>(`/v1/public/orgs/${org}`);
  const [token, setToken] = useState(() => readToken(org));
  const [copiado, setCopiado] = useState(false);
  const mine = useQuery<MyTickets>({
    queryKey: ['my-tickets', org, token],
    queryFn: () => request<MyTickets>(`/v1/public/orgs/${org}/my-tickets`, { token: token! }),
    enabled: Boolean(token),
    retry: false,
  });

  const salir = () => {
    try {
      sessionStorage.removeItem(tokenKey(org));
    } catch {
      /* nada */
    }
    setToken(null);
  };
  const expirado = mine.error instanceof ApiError && mine.error.status === 401;
  useEffect(() => {
    if (expirado) salir();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expirado]);

  const o = orgInfo.data;
  const d = mine.data;
  const activos = d?.raffles.filter((r) => r.status === 'active' || r.status === 'sold_out' || r.status === 'closed') ?? [];
  const anteriores = d?.raffles.filter((r) => r.status === 'drawn' || r.status === 'cancelled') ?? [];
  const tz = o?.timezone;

  return (
    <PubFrame acento={o?.accentColor}>
      <header className="pub-header pub-header--bar">
        <Link to={`/${org}`} className="rs-btn rs-btn--secundario rs-btn--sm icon-btn" aria-label="Volver">
          <Icon name="arrowLeft" strokeWidth={2.2} />
        </Link>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="header-titulo">Mis boletos</div>
          {o && <div className="header-sub">{o.name}</div>}
        </div>
        {token && <button type="button" className="rs-btn rs-btn--secundario rs-btn--sm" onClick={salir}>Salir</button>}
      </header>

      <main className="pub-main">
        {!token && <Acceso org={org} onToken={setToken} />}
        {token && mine.isLoading && <Loading />}
        {token && mine.error && !(mine.error instanceof ApiError && mine.error.status === 401) && <ErrorNote error={mine.error} />}

        {d && (
          <>
            <section className="stack" style={{ gap: 4 }}>
              <h1 className="h2">Hola, {d.participant.nickname ?? d.participant.name.split(' ')[0]}</h1>
              {d.raffles.length === 0 && <p className="muted">Todavía no tienes boletos con este número.</p>}
            </section>

            {d.ranking && (
              <Link to={`/${org}/ranking`} className="tu-puesto" style={{ textDecoration: 'none' }}>
                <span className="rs-display tu-puesto__n">{d.ranking.rank ?? '–'}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ font: '800 15px/20px var(--font-sans)' }}>
                    {d.ranking.rank ? `Vas en el puesto ${d.ranking.rank}` : 'Aún no sumas puntos'} · {d.ranking.points} pts
                  </div>
                  <div style={{ font: '600 13px/18px var(--font-sans)' }}>
                    {d.ranking.pointsToTop10 > 0 ? `Te faltan ${d.ranking.pointsToTop10} puntos para el top 10` : '¡Estás en el top 10!'} · Ranking de {monthLabel(d.ranking.period)}
                  </div>
                </div>
              </Link>
            )}

            {activos.map((r) => (
              <section key={r.slug} className="stack" style={{ gap: 12 }}>
                <div className="fila-sb">
                  <h2 className="h2 h2--sm">{r.title}</h2>
                  <Badge tono={ESTADO[r.status]?.tono ?? 'cerrado'}>{ESTADO[r.status]?.label ?? r.status}</Badge>
                </div>
                <p className="header-sub" style={{ marginTop: -6 }}>{r.lottery} · {formatDraw(r.drawAt, tz)}</p>
                {r.tickets.map((t) => (
                  <article key={t.code} className="rs-card boleto">
                    <div className="boleto__num boleto__num--pago"><span className="rs-mono">{t.number}</span></div>
                    <div className="boleto__info">
                      <span className="boleto__estado boleto__estado--ok"><Icon name="check" size={16} strokeWidth={2.6} />Pago confirmado</span>
                      <span className="boleto__meta">Boleto {t.code}</span>
                    </div>
                  </article>
                ))}
                {r.pending.flatMap((p) =>
                  p.numbers.map((n) => (
                    <article key={`${p.orderId}-${n}`} className="rs-card boleto">
                      <div className="boleto__num"><span className="rs-mono">{n}</span></div>
                      <div className="boleto__info">
                        <span className="boleto__estado boleto__estado--espera">
                          <Icon name="clock" size={16} strokeWidth={2.4} />
                          {p.status === 'reserved' ? 'Apartado · falta el pago' : 'Verificando pago'}
                        </span>
                        {p.status === 'reserved' && <Link to={`/${org}/${r.slug}/pagar`} className="small-link">Pagar ahora</Link>}
                      </div>
                    </article>
                  )),
                )}
              </section>
            ))}

            {o?.supportWhatsapp && activos.length > 0 && (
              <a href={waLink(o.supportWhatsapp)} className="rs-btn rs-btn--secundario" style={{ width: '100%' }} target="_blank" rel="noreferrer">
                <Icon name="whatsapp" size={18} />
                Escribir a {o.name}
              </a>
            )}

            {d.participant.referralCode && (
              <section className="rs-card stack" style={{ padding: 16, gap: 8 }}>
                <span style={{ font: '700 15px/20px var(--font-sans)' }}>Invita y suma puntos</span>
                <span className="muted" style={{ font: '500 14px/20px var(--font-sans)' }}>
                  Comparte tu enlace. Cuando alguien compre con él, sumas puntos en el ranking.
                </span>
                <button
                  type="button"
                  className="rs-btn rs-btn--secundario"
                  onClick={() => {
                    copy(`${window.location.origin}/${org}?ref=${d.participant.referralCode}`);
                    setCopiado(true);
                  }}
                >
                  <Icon name={copiado ? 'check' : 'link'} size={18} />
                  {copiado ? 'Enlace copiado' : 'Copiar mi enlace'}
                </button>
              </section>
            )}

            {anteriores.length > 0 && (
              <section className="stack" style={{ gap: 12, paddingTop: 8, borderTop: '1px solid var(--linea)' }}>
                <h2 className="eyebrow" style={{ paddingTop: 12 }}>Sorteos anteriores</h2>
                {anteriores.map((r) =>
                  r.won.length > 0 ? (
                    <article key={r.slug} className="rs-card ganaste">
                      <div className="fila-sb">
                        <span style={{ font: '700 15px/20px var(--font-sans)' }}>{r.title}</span>
                        <Badge tono="ganador">★ Ganaste</Badge>
                      </div>
                      {r.won.map((w) => (
                        <div key={w.number} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <span className="num-tag num-tag--oro" style={{ padding: '6px 12px', fontSize: 18 }}>{w.number}</span>
                          <span className="muted" style={{ font: '500 14px/20px var(--font-sans)' }}>
                            <b style={{ color: 'var(--tinta)' }}>{typeof w.prize === 'number' ? cop(w.prize) : w.prize}</b>
                            {w.delivered ? ' · Entregado' : ' · Por entregar'}
                          </span>
                        </div>
                      ))}
                    </article>
                  ) : (
                    <Link key={r.slug} to={`/${org}/${r.slug}/resultado`} className="rs-card fila-sb" style={{ padding: 16, gap: 12, textDecoration: 'none', color: 'inherit' }}>
                      <div>
                        <div style={{ font: '700 15px/20px var(--font-sans)' }}>{r.title}</div>
                        <div className="boleto__meta">
                          Jugaste con {r.tickets.map((t) => t.number).join(', ') || '—'}
                          {r.result ? ` · Cayó ${r.result.mainResult}` : ''}
                        </div>
                      </div>
                      <Badge tono="cerrado">{ESTADO[r.status]?.label ?? 'Cerrado'}</Badge>
                    </Link>
                  ),
                )}
              </section>
            )}
          </>
        )}
      </main>
      <PubFooter show={o?.showRifaStarBadge ?? true} />
    </PubFrame>
  );
}
