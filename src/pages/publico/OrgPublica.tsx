import { useEffect } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { usePublicQuery } from '@/api/hooks';
import { Badge } from '@/components/Badge';
import { PubFrame } from '@/components/PubFrame';
import { Empty, Foto } from '@/components/ui';
import { cop } from '@/lib/format';
import { formatDraw } from '@/lib/time';
import { AvisameForm } from './Agotado';
import { PubError, PubFooter, PubHeader, PubLoading, rememberLinkCodes, type PublicOrg } from './shared';
import './publico.css';

/** rifastar.co/{org}: sorteos en venta y recientes de la organización. */
export default function OrgPublica() {
  const { org = '' } = useParams();
  const [search] = useSearchParams();
  useEffect(() => rememberLinkCodes(org, search), [org, search]);
  const q = usePublicQuery<PublicOrg>(`/v1/public/orgs/${org}`);
  if (q.isLoading) return <PubLoading />;
  if (q.error || !q.data) return <PubError error={q.error} />;
  const o = q.data;
  const enVenta = o.raffles.filter((r) => r.status === 'active');
  const anteriores = o.raffles.filter((r) => r.status !== 'active');

  return (
    <PubFrame acento={o.accentColor}>
      <PubHeader org={o} />
      <main className="pub-main">
        <section className="stack" style={{ gap: 8 }}>
          <span className="eyebrow">Organiza</span>
          <h1 className="pub-title" style={{ fontSize: 32, lineHeight: '34px' }}>{o.name}</h1>
          <p className="muted" style={{ font: '500 14px/20px var(--font-sans)' }}>{o.rafflesCompleted} sorteos realizados</p>
        </section>

        <section className="stack" style={{ gap: 12 }}>
          <h2 className="h2">En venta</h2>
          {enVenta.length === 0 && <Empty>No hay sorteos en venta ahora.</Empty>}
          {enVenta.map((r) => (
            <Link key={r.slug} to={`/${o.slug}/${r.slug}`} className="rs-card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8, textDecoration: 'none', color: 'inherit' }}>
              <Foto src={r.coverUrl ?? undefined} alt="" style={{ width: '100%', aspectRatio: '16/9', objectFit: 'cover', borderRadius: 12 }} />
              <b style={{ font: '800 18px/24px var(--font-sans)' }}>{r.title}</b>
              <span className="muted">{r.lottery} · {formatDraw(r.drawAt, o.timezone)}</span>
              <div className="rs-progreso"><span style={{ width: `${Math.round((r.progress.paid / r.progress.total) * 100)}%` }} /></div>
              <span className="rs-mono">{cop(r.pricePerNumber)} cada número</span>
            </Link>
          ))}
        </section>

        {o.rankingEnabled && (
          <Link to={`/${o.slug}/ranking`} className="rs-btn rs-btn--secundario boton-ancho">Ver el ranking</Link>
        )}

        {anteriores.length > 0 && (
          <section className="stack" style={{ gap: 12 }}>
            <h2 className="eyebrow">Sorteos recientes</h2>
            {anteriores.map((r) => (
              <Link key={r.slug} to={`/${o.slug}/${r.slug}${r.resultsPublished ? '/resultado' : ''}`} className="rs-card fila-sb" style={{ padding: 16, gap: 12, textDecoration: 'none', color: 'inherit' }}>
                <div>
                  <div style={{ font: '700 15px/20px var(--font-sans)' }}>{r.title}</div>
                  <div className="boleto__meta">{formatDraw(r.drawAt, o.timezone)}</div>
                </div>
                <Badge tono={r.resultsPublished ? 'ganador' : 'cerrado'}>{r.resultsPublished ? 'Ver ganadores' : r.status === 'sold_out' ? 'Agotado' : 'Cerrado'}</Badge>
              </Link>
            ))}
          </section>
        )}

        <AvisameForm org={o.slug} />
      </main>
      <PubFooter show={o.showRifaStarBadge} />
    </PubFrame>
  );
}
