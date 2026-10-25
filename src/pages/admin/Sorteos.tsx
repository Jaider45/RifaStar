import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useCan, useOrgProfile, useOrgQuery } from '@/api/hooks';
import type { Raffle, RaffleStatus } from '@/api/types';
import { Badge, type BadgeTono } from '@/components/Badge';
import { Icon } from '@/components/Icon';
import { PageHeader } from '@/components/PageHeader';
import { copy, Empty, ErrorNote, Loading } from '@/components/ui';
import { useSession } from '@/api/session';
import { cop, pad } from '@/lib/format';
import { formatDraw, formatTime } from '@/lib/time';
import { useCountdown } from '@/lib/useCountdown';
import './Sorteos.css';

const FILTROS = [
  { id: 'todos', label: 'Todos', estados: null },
  { id: 'activos', label: 'Activos', estados: ['active', 'sold_out', 'closed'] },
  { id: 'finalizados', label: 'Finalizados', estados: ['drawn', 'cancelled'] },
  { id: 'borradores', label: 'Borradores', estados: ['draft'] },
] as const;

export const ESTADO_SORTEO: Record<RaffleStatus, { label: string; tono: BadgeTono }> = {
  draft: { label: 'Borrador', tono: 'cerrado' },
  active: { label: 'Abierto', tono: 'abierto' },
  sold_out: { label: 'Agotado', tono: 'vivo' },
  closed: { label: 'Venta cerrada', tono: 'urgente' },
  drawn: { label: 'Jugado', tono: 'ganador' },
  cancelled: { label: 'Cancelado', tono: 'cerrado' },
};

interface Dashboard {
  weekRevenueCop?: number;
  weekApprovedOrders?: number;
  pendingPayments: number;
  activeRaffles: number;
  nextRaffle: { id: string; title: string; slug: string; drawAt: string; status: string; progress: { paid: number; held: number; total: number } } | null;
}

function Reloj({ drawAt }: { drawAt: string }) {
  const r = useCountdown(new Date(drawAt).getTime());
  return (
    <span className="kpi--hoy__reloj" aria-label="Tiempo restante">
      {r.dias > 0 ? `${r.dias}d ` : ''}{pad(r.horas)}:{pad(r.minutos)}:{pad(r.segundos)}
    </span>
  );
}

export default function Sorteos() {
  const { me } = useSession();
  const { data: org } = useOrgProfile();
  const can = useCan();
  const [filtro, setFiltro] = useState<(typeof FILTROS)[number]['id']>('todos');
  const [copiado, setCopiado] = useState<string | null>(null);
  const dash = useOrgQuery<Dashboard>('/v1/dashboard');
  const raffles = useOrgQuery<Raffle[]>('/v1/raffles');
  const tz = org?.timezone;

  const estados = FILTROS.find((f) => f.id === filtro)?.estados;
  const filas = (raffles.data ?? []).filter((r) => !estados || (estados as readonly string[]).includes(r.status));
  const borradores = (raffles.data ?? []).filter((r) => r.status === 'draft').length;
  const primerNombre = me?.name.split(' ')[0] ?? 'equipo';
  const d = dash.data;
  const next = d?.nextRaffle;

  const accion = (r: Raffle) => {
    if (r.status === 'draft') return can('raffles.edit') ? { to: `/admin/sorteos/${r.id}`, label: 'Continuar' } : null;
    if (r.status === 'drawn' || r.status === 'closed') return { to: `/admin/ganadores/${r.id}`, label: 'Ver resultado' };
    if (r.status === 'cancelled') return null;
    return can('payments.view') ? { to: `/admin/pagos?sorteo=${r.id}`, label: 'Ver pagos' } : { to: `/admin/sorteos/${r.id}`, label: 'Ver' };
  };

  return (
    <div className="stack" style={{ gap: 28 }}>
      <PageHeader
        title={`Hola, ${primerNombre}`}
        sub={
          d
            ? `Tienes ${d.pendingPayments} ${d.pendingPayments === 1 ? 'pago' : 'pagos'} por verificar${next ? ` y tu próximo sorteo juega el ${formatDraw(next.drawAt, tz)}` : ''}.`
            : 'Resumen de tus sorteos.'
        }
        actions={
          <>
            {can('payments.view') && <Link to="/admin/pagos" className="rs-btn rs-btn--secundario">Verificar pagos</Link>}
            {can('raffles.edit') && (
              <Link to="/admin/sorteos/nuevo" className="rs-btn rs-btn--primario">
                <Icon name="plus" size={18} strokeWidth={2.4} />
                Nuevo sorteo
              </Link>
            )}
          </>
        }
      />

      <ErrorNote error={dash.error ?? raffles.error} />

      <section aria-label="Resumen" className="kpis">
        {d?.weekRevenueCop !== undefined && (
          <div className="rs-panel kpi">
            <span className="kpi__label">Recaudado esta semana</span>
            <span className="kpi__value">{cop(d.weekRevenueCop)}</span>
            <span className="kpi__note kpi__note--ok">{d.weekApprovedOrders} pagos aprobados</span>
          </div>
        )}
        <div className="rs-panel kpi">
          <span className="kpi__label">Pagos por verificar</span>
          <span className="kpi__value">{d?.pendingPayments ?? '—'}</span>
          {can('payments.view') && <Link to="/admin/pagos" className="small-link">Revisar ahora</Link>}
        </div>
        <div className="rs-panel kpi">
          <span className="kpi__label">Sorteos activos</span>
          <span className="kpi__value">{d?.activeRaffles ?? '—'}</span>
          <span className="kpi__note">{borradores} {borradores === 1 ? 'borrador' : 'borradores'}</span>
        </div>
        <div className="rs-panel kpi kpi--hoy">
          <span className="kpi__label">{next ? `Próximo · ${formatTime(next.drawAt, tz)}` : 'Próximo sorteo'}</span>
          <span className="kpi--hoy__nombre">{next?.title ?? 'Sin sorteos programados'}</span>
          {next && <Reloj drawAt={next.drawAt} />}
        </div>
      </section>

      <section className="rs-panel overflow-hidden">
        <div className="panel-head">
          <h2 className="h2">Mis sorteos</h2>
          <div className="chips">
            {FILTROS.map((f) => (
              <button key={f.id} type="button" className="rs-chip" aria-pressed={filtro === f.id} onClick={() => setFiltro(f.id)}>
                {f.label}
              </button>
            ))}
          </div>
        </div>
        {raffles.isLoading ? (
          <Loading />
        ) : (
          <div className="table-scroll">
            <table className="rs-tabla" style={{ minWidth: 860 }}>
              <thead>
                <tr>
                  <th>Sorteo</th>
                  <th>Juega</th>
                  <th style={{ width: 200 }}>Vendidos</th>
                  {can('payments.view') && <th>Recaudo</th>}
                  <th>Estado</th>
                  <th style={{ textAlign: 'right' }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((r) => {
                  const pct = Math.round((r.progress.paid / r.totalNumbers) * 100);
                  const a = accion(r);
                  const enlace = r.publicUrl.replace(/^https?:\/\//, '');
                  return (
                    <tr key={r.id}>
                      <td>
                        <div className="sorteo-cell">
                          {r.coverUrl ? (
                            <img src={r.coverUrl} alt="" className="rs-foto sorteo-cell__foto" style={{ objectFit: 'cover' }} />
                          ) : (
                            <span className="rs-foto sorteo-cell__foto" aria-hidden="true" />
                          )}
                          <div>
                            <div className="sorteo-cell__nombre">{r.title}</div>
                            <div className="rs-mono sorteo-cell__slug">{r.status === 'draft' ? 'Sin publicar' : enlace}</div>
                          </div>
                        </div>
                      </td>
                      <td>{formatDraw(r.drawAt, tz)}</td>
                      <td>
                        <div className="rs-progreso" style={{ height: 8 }}>
                          <span style={{ width: `${pct}%` }} />
                        </div>
                        <div className="sorteo-cell__vendidos">
                          {r.progress.paid} de {r.totalNumbers.toLocaleString('es-CO')} · {pct}%
                        </div>
                      </td>
                      {can('payments.view') && <td className="td-mono">{cop(r.collectedCop ?? 0)}</td>}
                      <td>
                        <Badge tono={ESTADO_SORTEO[r.status].tono}>{ESTADO_SORTEO[r.status].label}</Badge>
                      </td>
                      <td className="td-right">
                        {r.status !== 'draft' && (
                          <button
                            type="button"
                            className="rs-btn rs-btn--secundario rs-btn--sm"
                            aria-label={`Copiar enlace de ${r.title}`}
                            onClick={async () => {
                              await copy(r.publicUrl);
                              setCopiado(r.id);
                              window.setTimeout(() => setCopiado(null), 1600);
                            }}
                          >
                            <Icon name={copiado === r.id ? 'check' : 'link'} size={16} />
                            {copiado === r.id ? 'Copiado' : 'Enlace'}
                          </button>
                        )}
                        {a && <Link to={a.to} className="rs-btn rs-btn--fantasma rs-btn--sm">{a.label}</Link>}
                      </td>
                    </tr>
                  );
                })}
                {filas.length === 0 && (
                  <tr>
                    <td colSpan={6}>
                      <Empty>
                        {raffles.data?.length ? 'No hay sorteos en esta lista.' : 'Aún no tienes sorteos. Crea el primero con «Nuevo sorteo».'}
                      </Empty>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
