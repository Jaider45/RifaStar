import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError, request } from '@/api/client';
import { usePublicQuery } from '@/api/hooks';
import { Badge } from '@/components/Badge';
import { Icon } from '@/components/Icon';
import { PubFrame } from '@/components/PubFrame';
import { ErrorNote } from '@/components/ui';
import { cop } from '@/lib/format';
import { formatDraw, formatLongDay } from '@/lib/time';
import { PubError, PubFooter, PubHeader, PubLoading, type PublicOrg, type PublicRaffle } from './shared';
import './publico.css';

interface PublicResults {
  raffle: { slug: string; title: string; lottery: string; drawAt: string; digits: number };
  result: { mainResult: string; anticipatedResult: string | null; publishedAt: string; evidenceUrls: string[] };
  prizes: {
    position: number;
    amountCop: number | null;
    description: string | null;
    ruleLabel: string;
    winners: { number: string; unsold: boolean; name: string; phone: string | null; delivered: boolean }[];
  }[];
}

/** «Avísame»: deja el WhatsApp para enterarse cuando abra la próxima venta. */
export function AvisameForm({ org, titulo = 'Próximo sorteo', fecha }: { org: string; titulo?: string; fecha?: string }) {
  const [nombre, setNombre] = useState('');
  const [wa, setWa] = useState('');
  const [listo, setListo] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await request(`/v1/public/orgs/${org}/notify-me`, { body: { name: nombre.trim(), phone: wa } });
      setListo(true);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="proximo">
      <span className="venta__eyebrow">{titulo}</span>
      {fecha && <span className="rs-display" style={{ fontSize: 26, lineHeight: '28px', fontWeight: 800 }}>{fecha}</span>}
      {listo ? (
        <span style={{ font: '600 14px/20px var(--font-sans)' }}>¡Listo! Te escribimos por WhatsApp cuando abra la venta.</span>
      ) : (
        <form className="stack" style={{ gap: 8 }} onSubmit={enviar}>
          <span style={{ font: '500 14px/20px var(--font-sans)' }}>Te avisamos por WhatsApp cuando abra la venta.</span>
          <input className="rs-in fill-in" placeholder="Tu nombre" aria-label="Tu nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} required minLength={2} autoComplete="name" />
          <input className="rs-in rs-mono fill-in" placeholder="Tu WhatsApp" aria-label="Tu WhatsApp" value={wa} onChange={(e) => setWa(e.target.value)} required inputMode="tel" autoComplete="tel-national" />
          <ErrorNote error={error} />
          <button type="submit" className="rs-btn proximo__btn" disabled={busy}>{busy ? 'Enviando…' : 'Avísame'}</button>
        </form>
      )}
    </section>
  );
}

export default function Agotado() {
  const { org = '', sorteo = '' } = useParams();
  const raffle = usePublicQuery<PublicRaffle>(`/v1/public/orgs/${org}/raffles/${sorteo}`);
  const results = usePublicQuery<PublicResults>(`/v1/public/orgs/${org}/raffles/${sorteo}/results`);
  const orgInfo = usePublicQuery<PublicOrg>(`/v1/public/orgs/${org}`);

  if (raffle.isLoading || results.isLoading) return <PubLoading />;
  if (raffle.error || !raffle.data) return <PubError error={raffle.error} />;
  const sinResultado = results.error instanceof ApiError && results.error.code === 'RESULTS_NOT_PUBLISHED';
  if (results.error && !sinResultado) return <PubError error={results.error} />;

  const { raffle: r, organization } = raffle.data;
  const tz = organization.timezone;
  const res = results.data;
  const vendido = r.status === 'sold_out';
  const siguiente = orgInfo.data?.nextRaffle && orgInfo.data.nextRaffle.slug !== r.slug ? orgInfo.data.nextRaffle : null;
  const ganadores = res?.prizes.flatMap((p) => p.winners.map((w) => ({ ...w, prize: p }))) ?? [];

  return (
    <PubFrame acento={r.accentColor}>
      <PubHeader org={organization} />

      <main className="pub-main pub-main--tight">
        <section className="stack" style={{ gap: 8 }}>
          <Badge tono="cerrado" style={{ alignSelf: 'flex-start' }}>{res ? 'Sorteo realizado' : vendido ? 'Agotado' : r.status === 'cancelled' ? 'Cancelado' : 'Venta cerrada'}</Badge>
          <h1 className="pub-title" style={{ fontSize: 30, lineHeight: '32px' }}>{r.title}</h1>
          <p className="venta__meta">{r.lottery} · {formatDraw(r.drawAt, tz)}</p>
        </section>

        {!res && (
          <section className="rs-card agotado">
            <div aria-hidden="true" className="agotado__icono">
              <Icon name={vendido ? 'check' : 'clock'} size={32} strokeWidth={3} />
            </div>
            <h2 className="pub-title" style={{ fontSize: 24, lineHeight: '28px' }}>
              {vendido ? `¡Se vendieron los ${r.totalNumbers} números!` : r.status === 'cancelled' ? 'Este sorteo fue cancelado' : 'La venta ya cerró'}
            </h2>
            <p className="muted" style={{ font: '500 15px/22px var(--font-sans)' }}>
              {r.status === 'cancelled'
                ? `${organization.name} se comunica contigo por WhatsApp para la devolución.`
                : 'Gracias a todos los que participaron. Aquí publicamos los ganadores apenas salga el resultado.'}
            </p>
          </section>
        )}

        {res && (
          <section className="stack" style={{ gap: 12 }}>
            <div className="fila-sb">
              <h2 className="h2" style={{ lineHeight: '26px' }}>Resultado</h2>
              <Badge tono="ganador">★ Ganadores</Badge>
            </div>
            <div className="rs-card stack" style={{ padding: 16, gap: 12 }}>
              <span className="muted" style={{ font: '600 13px/18px var(--font-sans)' }}>Número de la {res.raffle.lottery}</span>
              <div className="digitos" aria-label={`Resultado ${res.result.mainResult}`}>
                {res.result.mainResult.split('').map((d, i) => (
                  <span key={i} className="rs-mono" aria-hidden="true">{d}</span>
                ))}
              </div>
              {res.result.anticipatedResult && (
                <span className="muted" style={{ font: '600 13px/18px var(--font-sans)' }}>
                  Anticipado: <b className="rs-mono" style={{ color: 'var(--tinta)' }}>{res.result.anticipatedResult}</b>
                </span>
              )}
              {res.result.evidenceUrls.map((u, i) => (
                <a key={u} href={u} target="_blank" rel="noreferrer" className="small-link">Ver resultado oficial{res.result.evidenceUrls.length > 1 ? ` (${i + 1})` : ''}</a>
              ))}
            </div>

            <div className="rs-card list-card">
              {ganadores.length === 0 && <div className="list-row muted">Ningún número premiado.</div>}
              {ganadores.map((g, i) => (
                <div key={`${g.prize.position}-${g.number}`} className="list-row">
                  <span className={`rs-mono ganador-num${i === 0 ? ' ganador-num--oro' : ''}`}>{g.number}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ font: '700 15px/20px var(--font-sans)' }}>{g.unsold ? 'Número no vendido' : `${g.name}${g.phone ? ` · ${g.phone}` : ''}`}</div>
                    <div className="header-sub">{g.prize.ruleLabel}{g.delivered ? ' · Entregado' : ''}</div>
                  </div>
                  <span className="rs-display" style={{ fontSize: 17, lineHeight: '22px', fontWeight: 800, whiteSpace: 'nowrap' }}>
                    {g.prize.amountCop != null ? cop(g.prize.amountCop) : g.prize.description}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        {siguiente && siguiente.status === 'active' ? (
          <section className="proximo">
            <span className="venta__eyebrow">Próximo sorteo</span>
            <span className="rs-display" style={{ fontSize: 26, lineHeight: '28px', fontWeight: 800 }}>{formatLongDay(siguiente.drawAt, tz)}</span>
            <span style={{ font: '500 14px/20px var(--font-sans)' }}>{siguiente.title} · {cop(siguiente.pricePerNumber)} el número</span>
            <Link to={`/${org}/${siguiente.slug}`} className="rs-btn proximo__btn">Elegir mis números</Link>
          </section>
        ) : (
          <AvisameForm org={org} fecha={siguiente ? formatLongDay(siguiente.drawAt, tz) : undefined} />
        )}
      </main>
      <PubFooter show={organization.showRifaStarBadge} />
    </PubFrame>
  );
}
