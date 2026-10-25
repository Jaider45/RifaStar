import { useState } from 'react';
import { usePlatformMutation, usePlatformQuery } from '@/api/hooks';
import { usePlatform } from '@/api/platform-session';
import { Badge, type BadgeTono } from '@/components/Badge';
import { PageHeader } from '@/components/PageHeader';
import { Empty, ErrorNote, Loading } from '@/components/ui';
import { cop } from '@/lib/format';
import { formatDay, timeAgo } from '@/lib/time';
import './plataforma.css';

type SubStatus = 'trialing' | 'active' | 'past_due' | 'canceled' | 'incomplete';
interface OrgRef { id: string; name: string; slug: string; status: string }
interface Subscription {
  id: string;
  organization: OrgRef;
  plan: { code: string; name: string; monthlyPriceCop: number };
  status: SubStatus;
  provider: string;
  currentPeriodEnd: string | null;
  pastDueSince: string | null;
  cancelAtPeriodEnd: boolean;
}
interface FailedPayment { id: string; organization: OrgRef; amountCop: number; attemptedAt: string | null; failureReason: string | null }
interface BillingEvent { id: string; provider: string; type: string; externalEventId: string; receivedAt: string; processedAt: string | null; attempts: number; lastError: string | null }
interface PlanLite { id: string; code: string; name: string; archivedAt: string | null }

const ESTADO: Record<SubStatus, { label: string; tono: BadgeTono }> = {
  trialing: { label: 'En prueba', tono: 'cerrado' },
  active: { label: 'Activa', tono: 'abierto' },
  past_due: { label: 'Pago fallido', tono: 'urgente' },
  canceled: { label: 'Cancelada', tono: 'cerrado' },
  incomplete: { label: 'Incompleta', tono: 'vivo' },
};

const PESTANAS = [
  { id: 'subs', label: 'Suscripciones' },
  { id: 'fallidos', label: 'Cobros fallidos' },
  { id: 'eventos', label: 'Eventos del proveedor' },
] as const;

function CambiarPlan({ sub, planes }: { sub: Subscription; planes: PlanLite[] }) {
  const cambiar = usePlatformMutation<string>((planCode, req) => req(`/v1/platform/orgs/${sub.organization.id}/subscription`, { method: 'PUT', body: { planCode } }));
  return (
    <>
      <select
        className="rs-in"
        aria-label={`Plan de ${sub.organization.name}`}
        style={{ width: 160 }}
        value={sub.plan.code}
        disabled={cambiar.isPending}
        onChange={(e) => window.confirm(`¿Asignar manualmente el plan ${e.target.value} a ${sub.organization.name}?`) && cambiar.mutate(e.target.value)}
      >
        {planes.filter((p) => !p.archivedAt || p.code === sub.plan.code).map((p) => <option key={p.id} value={p.code}>{p.name}</option>)}
      </select>
      <ErrorNote error={cambiar.error} />
    </>
  );
}

export default function Facturacion() {
  const { can } = usePlatform();
  const escribir = can('platform.billing.write');
  const [tab, setTab] = useState<(typeof PESTANAS)[number]['id']>('subs');
  const [estado, setEstado] = useState<SubStatus | ''>('');
  const subs = usePlatformQuery<Subscription[]>(tab === 'subs' ? `/v1/platform/billing/subscriptions${estado ? `?status=${estado}` : ''}` : null);
  const failed = usePlatformQuery<FailedPayment[]>(tab === 'fallidos' ? '/v1/platform/billing/failed-payments' : null);
  const events = usePlatformQuery<BillingEvent[]>(tab === 'eventos' ? '/v1/platform/billing/events' : null);
  const planes = usePlatformQuery<PlanLite[]>(escribir && tab === 'subs' ? '/v1/platform/plans' : null);
  const reintentar = usePlatformMutation<string>((id, req) => req(`/v1/platform/billing/events/${id}/retry`, { method: 'POST' }));

  const q = tab === 'subs' ? subs : tab === 'fallidos' ? failed : events;

  return (
    <>
      <PageHeader title="Facturación" sub="Suscripciones de las organizaciones, cobros fallidos y los eventos que envía el proveedor de pagos." />

      <div role="tablist" aria-label="Sección" className="segmento-claro">
        {PESTANAS.map((p) => (
          <button key={p.id} type="button" role="tab" aria-selected={tab === p.id} onClick={() => setTab(p.id)}>{p.label}</button>
        ))}
      </div>

      <section className="rs-panel overflow-hidden" role="tabpanel">
        {tab === 'subs' && (
          <div className="panel-head">
            <div className="chips">
              <button type="button" className="rs-chip" aria-pressed={estado === ''} onClick={() => setEstado('')}>Todas</button>
              {(Object.keys(ESTADO) as SubStatus[]).map((s) => (
                <button key={s} type="button" className="rs-chip" aria-pressed={estado === s} onClick={() => setEstado(s)}>{ESTADO[s].label}</button>
              ))}
            </div>
          </div>
        )}
        {q.isLoading && <Loading />}
        <ErrorNote error={q.error ?? reintentar.error} style={{ margin: 16 }} />

        {tab === 'subs' && subs.data && (
          <div className="table-scroll">
            <table className="rs-tabla" style={{ minWidth: 900 }}>
              <thead><tr><th>Organización</th><th>Plan</th><th>Estado</th><th>Proveedor</th><th>Renueva</th></tr></thead>
              <tbody>
                {subs.data.map((s) => (
                  <tr key={s.id}>
                    <td><b>{s.organization.name}</b><br /><span className="rs-mono cell-sub">{s.organization.slug}</span></td>
                    <td>
                      {escribir && planes.data ? <CambiarPlan sub={s} planes={planes.data} /> : <b>{s.plan.name}</b>}
                      <span className="cell-sub">{cop(s.plan.monthlyPriceCop)} / mes</span>
                    </td>
                    <td>
                      <Badge tono={ESTADO[s.status].tono}>{ESTADO[s.status].label}</Badge>
                      {s.pastDueSince && <><br /><span className="cell-sub">desde {formatDay(s.pastDueSince)}</span></>}
                    </td>
                    <td className="cell-sub">{s.provider}</td>
                    <td className="cell-sub">
                      {s.currentPeriodEnd ? formatDay(s.currentPeriodEnd) : '—'}
                      {s.cancelAtPeriodEnd && <><br />Se cancela al final del periodo</>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {subs.data.length === 0 && <Empty>No hay suscripciones con ese estado.</Empty>}
          </div>
        )}

        {tab === 'fallidos' && failed.data && (
          <div className="table-scroll">
            <table className="rs-tabla" style={{ minWidth: 720 }}>
              <thead><tr><th>Organización</th><th>Valor</th><th>Intento</th><th>Motivo</th></tr></thead>
              <tbody>
                {failed.data.map((f) => (
                  <tr key={f.id}>
                    <td><b>{f.organization.name}</b><br /><span className="rs-mono cell-sub">{f.organization.slug}</span></td>
                    <td className="rs-mono">{cop(f.amountCop)}</td>
                    <td className="cell-sub">{f.attemptedAt ? timeAgo(f.attemptedAt) : '—'}</td>
                    <td>{f.failureReason ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {failed.data.length === 0 && <Empty>Sin cobros fallidos.</Empty>}
          </div>
        )}

        {tab === 'eventos' && events.data && (
          <div className="table-scroll">
            <table className="rs-tabla" style={{ minWidth: 900 }}>
              <thead><tr><th>Evento</th><th>Recibido</th><th>Estado</th><th>Intentos</th><th style={{ textAlign: 'right' }} /></tr></thead>
              <tbody>
                {events.data.map((e) => (
                  <tr key={e.id}>
                    <td><b>{e.type}</b><br /><span className="rs-mono cell-sub">{e.provider} · {e.externalEventId}</span></td>
                    <td className="cell-sub">{timeAgo(e.receivedAt)}</td>
                    <td>
                      {e.processedAt ? <Badge tono="abierto">Procesado</Badge> : <Badge tono="urgente">Pendiente</Badge>}
                      {e.lastError && <><br /><span className="cell-sub" style={{ color: 'var(--rojo-texto)' }}>{e.lastError}</span></>}
                    </td>
                    <td className="rs-mono">{e.attempts}</td>
                    <td className="td-right">
                      {escribir && !e.processedAt && (
                        <button type="button" className="rs-btn rs-btn--secundario rs-btn--sm" disabled={reintentar.isPending} onClick={() => reintentar.mutate(e.id)}>Reprocesar</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {events.data.length === 0 && <Empty>Sin eventos todavía.</Empty>}
          </div>
        )}
      </section>
    </>
  );
}
