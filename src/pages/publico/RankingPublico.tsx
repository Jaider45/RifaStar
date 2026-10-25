import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { request } from '@/api/client';
import { usePublicQuery } from '@/api/hooks';
import { Badge } from '@/components/Badge';
import { PubFrame } from '@/components/PubFrame';
import { pad } from '@/lib/format';
import { formatDay, monthLabel } from '@/lib/time';
import { useCountdown } from '@/lib/useCountdown';
import { PubError, PubFooter, PubHeader, PubLoading, type PublicOrg } from './shared';
import './publico.css';

interface PublicRanking {
  period: { label: string; status: 'open' | 'closed'; startsAt: string; endsAt: string };
  closesAt: string | null;
  prizes: string[];
  participants: number;
  top: { rank: number; name: string; phone: string; points: number }[];
}

interface MyPosition {
  ranking: { period: string; rank: number | null; points: number; pointsToTop10: number } | null;
}

function Cierre({ hasta, tz }: { hasta: string; tz: string }) {
  const r = useCountdown(new Date(hasta).getTime());
  return (
    <section className="rs-card fila-sb" style={{ padding: '14px 16px', gap: 12 }}>
      <span className="muted" style={{ font: '600 14px/20px var(--font-sans)' }}>Cierra el {formatDay(hasta, tz)}</span>
      <span className="rs-mono" style={{ fontSize: 20, lineHeight: '24px', fontWeight: 700 }} aria-label={`Faltan ${r.dias} días y ${r.horas} horas`}>
        {r.dias}d · {r.horas}h · {pad(r.minutos)}m
      </span>
    </section>
  );
}

export default function RankingPublico() {
  const { org = '' } = useParams();
  const orgInfo = usePublicQuery<PublicOrg>(`/v1/public/orgs/${org}`);
  const ranking = usePublicQuery<PublicRanking>(`/v1/public/orgs/${org}/ranking`);
  let token: string | null = null;
  try {
    token = sessionStorage.getItem(`rs_pt_${org}`);
  } catch {
    token = null;
  }
  const mine = useQuery<MyPosition>({
    queryKey: ['my-tickets', org, token],
    queryFn: () => request<MyPosition>(`/v1/public/orgs/${org}/my-tickets`, { token: token! }),
    enabled: Boolean(token),
    retry: false,
  });

  if (orgInfo.isLoading || ranking.isLoading) return <PubLoading />;
  if (orgInfo.error || !orgInfo.data) return <PubError error={orgInfo.error} />;
  if (ranking.error || !ranking.data) return <PubError error={ranking.error} />;
  const o = orgInfo.data;
  const rk = ranking.data;
  const podio = [rk.top[1], rk.top[0], rk.top[2]];
  const alturas = { 1: { alto: 148, size: 44, pad: 14 }, 2: { alto: 108, size: 34, pad: 12 }, 3: { alto: 84, size: 30, pad: 10 } } as const;
  const resto = rk.top.slice(3);
  const yo = mine.data?.ranking ?? null;
  const siguiente = o.nextRaffle?.status === 'active' ? o.nextRaffle : null;

  return (
    <PubFrame acento={o.accentColor}>
      <PubHeader org={o} />

      <main className="pub-main pub-main--tight">
        <section className="stack" style={{ gap: 8 }}>
          <span className="eyebrow">{o.name}</span>
          <h1 className="pub-title" style={{ fontSize: 34, lineHeight: '34px' }}>Ranking de {monthLabel(rk.period.label)}</h1>
          <p className="muted" style={{ font: '500 14px/20px var(--font-sans)' }}>
            Cada número pagado suma puntos.{rk.prizes.length > 0 ? ` Los ${rk.prizes.length} primeros ganan premio al cerrar el periodo.` : ''}
            {' '}{rk.participants} participantes.
          </p>
        </section>

        {rk.closesAt ? <Cierre hasta={rk.closesAt} tz={o.timezone} /> : <Badge tono="cerrado" style={{ alignSelf: 'flex-start' }}>Periodo cerrado</Badge>}

        {rk.top.length === 0 ? (
          <p className="muted">Todavía nadie suma puntos en este periodo. ¡Sé el primero!</p>
        ) : (
          <section aria-label="Primeros tres puestos" className="podio">
            {podio.map((f, i) => {
              const puesto = (i === 0 ? 2 : i === 1 ? 1 : 3) as 1 | 2 | 3;
              const a = alturas[puesto];
              return (
                <div key={puesto} className="podio__col">
                  {puesto === 1 && f && <Badge tono="ganador">★ Líder</Badge>}
                  <span className="podio__nombre" style={puesto === 1 ? { fontSize: 15 } : undefined}>{f?.name ?? '—'}</span>
                  <span className="rs-mono podio__pts">{f ? `${f.points} pts` : ''}</span>
                  <div className={`podio__bloque${puesto === 1 ? ' podio__bloque--oro' : ''}`} style={{ height: a.alto, paddingTop: a.pad }}>
                    <span className="rs-display podio__puesto" style={{ fontSize: a.size, lineHeight: `${a.size}px` }}>{puesto}</span>
                    {rk.prizes[puesto - 1] && <span className="podio__premio">{rk.prizes[puesto - 1]}</span>}
                  </div>
                </div>
              );
            })}
          </section>
        )}

        {yo && yo.period === rk.period.label && (
          <section className="tu-puesto">
            <span className="rs-display tu-puesto__n">{yo.rank ?? '–'}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ font: '800 15px/20px var(--font-sans)' }}>{yo.rank ? `Vas en el puesto ${yo.rank}` : 'Aún no sumas puntos'}</div>
              <div style={{ font: '600 13px/18px var(--font-sans)' }}>
                {yo.pointsToTop10 > 0 ? `Te faltan ${yo.pointsToTop10} puntos para el top 10` : '¡Estás en el top 10!'}
              </div>
            </div>
          </section>
        )}

        {resto.length > 0 && (
          <section className="rs-card list-card">
            {resto.map((f) => (
              <div key={`${f.rank}-${f.phone}`} className={`rank-row${f.rank === 10 ? ' rank-row--corte' : ''}`}>
                <span className="rs-mono rank-row__pos">{f.rank}</span>
                <span className="rank-row__nombre">{f.name}</span>
                <span className="rs-mono" style={{ fontWeight: 700 }}>{f.points}</span>
              </div>
            ))}
          </section>
        )}

        {!yo && (
          <Link to={`/${org}/mis-boletos`} className="rs-btn rs-btn--secundario boton-ancho">¿No te ves? Consulta tu posición</Link>
        )}

        {siguiente && (
          <Link to={`/${org}/${siguiente.slug}`} className="rs-btn rs-btn--primario boton-ancho">Suma puntos en {siguiente.title}</Link>
        )}

        <p className="texto-pie" style={{ fontSize: 12, lineHeight: '16px' }}>
          Solo cuentan números pagos y verificados. En público mostramos el nombre corto y el WhatsApp enmascarado.
        </p>
      </main>
      <PubFooter show={o.showRifaStarBadge} />
    </PubFrame>
  );
}
