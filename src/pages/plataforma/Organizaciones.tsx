import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { usePlatformMutation, usePlatformQuery } from '@/api/hooks';
import { usePlatform } from '@/api/platform-session';
import { useSession } from '@/api/session';
import { Badge, type BadgeTono } from '@/components/Badge';
import { Icon } from '@/components/Icon';
import { PageHeader } from '@/components/PageHeader';
import { Empty, ErrorNote, Loading, Modal } from '@/components/ui';
import { cop } from '@/lib/format';
import { slugify } from '@/lib/slug';
import { formatDay, timeAgo } from '@/lib/time';

type OrgStatus = 'trial' | 'active' | 'past_due' | 'suspended';

interface OrgRow {
  id: string;
  name: string;
  slug: string;
  status: OrgStatus;
  owner: { name: string; email: string } | undefined;
  plan: { code: string; name: string; subscriptionStatus: string } | undefined;
  trialEndsAt: string | null;
  activeRaffles: number;
  lastAccessAt: string | null;
  createdAt: string;
}

interface Stats {
  organizations: { total: number; active: number; trial: number; pastDue: number; suspended: number };
  failedPayments30d: number;
  mrrCop?: number;
}

interface PlanLite { id: string; code: string; name: string; archivedAt: string | null }

const FILTROS: { id: OrgStatus | 'todas'; label: string }[] = [
  { id: 'todas', label: 'Todas' },
  { id: 'active', label: 'Activas' },
  { id: 'trial', label: 'En prueba' },
  { id: 'past_due', label: 'Pago fallido' },
  { id: 'suspended', label: 'Suspendidas' },
];

const ESTADO: Record<OrgStatus, { label: string; tono: BadgeTono }> = {
  active: { label: 'Activa', tono: 'abierto' },
  trial: { label: 'En prueba', tono: 'cerrado' },
  past_due: { label: 'Pago fallido', tono: 'urgente' },
  suspended: { label: 'Suspendida', tono: 'cerrado' },
};

function EntrarSoporte({ org, onClose }: { org: OrgRow; onClose: () => void }) {
  const session = useSession();
  const navigate = useNavigate();
  const [motivo, setMotivo] = useState('');
  const [minutos, setMinutos] = useState(30);
  const entrar = usePlatformMutation<void, { sessionId: string; organizationId: string; expiresAt: string; accessToken: string }>((_, req) =>
    req(`/v1/platform/orgs/${org.id}/support-sessions`, { body: { reason: motivo.trim(), minutes: minutos } }),
  );
  return (
    <Modal
      title={`Entrar como soporte · ${org.name}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="rs-btn rs-btn--secundario" onClick={onClose}>Cancelar</button>
          <button
            type="button"
            className="rs-btn rs-btn--primario"
            disabled={motivo.trim().length < 3 || entrar.isPending}
            onClick={() =>
              entrar.mutate(undefined, {
                onSuccess: (s) => {
                  session.startSupport({ token: s.accessToken, organizationId: s.organizationId, organizationName: org.name, expiresAt: s.expiresAt, sessionId: s.sessionId });
                  navigate('/admin');
                },
              })
            }
          >
            {entrar.isPending ? 'Entrando…' : 'Entrar en modo lectura'}
          </button>
        </>
      }
    >
      <p className="rs-help" style={{ marginTop: 0 }}>
        La cuenta se abre en solo lectura. El organizador ve un aviso mientras estés dentro y la sesión queda en el registro de actividad.
      </p>
      <label className="rs-label" htmlFor="motivo-soporte">Motivo</label>
      <textarea id="motivo-soporte" className="rs-in" rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej.: El organizador reporta que no ve un pago aprobado." />
      <label className="rs-label" htmlFor="minutos-soporte" style={{ marginTop: 12 }}>Duración</label>
      <select id="minutos-soporte" className="rs-in" value={minutos} onChange={(e) => setMinutos(Number(e.target.value))} style={{ width: 180 }}>
        {[15, 30, 45, 60].map((m) => <option key={m} value={m}>{m} minutos</option>)}
      </select>
      <ErrorNote error={entrar.error} style={{ marginTop: 12 }} />
    </Modal>
  );
}

function Suspender({ org, onClose }: { org: OrgRow; onClose: () => void }) {
  const [motivo, setMotivo] = useState('');
  const suspender = usePlatformMutation<void>((_, req) => req(`/v1/platform/orgs/${org.id}/suspend`, { body: { reason: motivo.trim() } }));
  return (
    <Modal
      title={`Suspender ${org.name}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="rs-btn rs-btn--secundario" onClick={onClose}>Cancelar</button>
          <button type="button" className="rs-btn rs-btn--urgente" disabled={motivo.trim().length < 3 || suspender.isPending} onClick={() => suspender.mutate(undefined, { onSuccess: onClose })}>
            {suspender.isPending ? 'Suspendiendo…' : 'Suspender cuenta'}
          </button>
        </>
      }
    >
      <p className="rs-help" style={{ marginTop: 0 }}>Su equipo no podrá entrar y sus páginas públicas dejan de vender. Puedes reactivarla cuando quieras.</p>
      <label className="rs-label" htmlFor="motivo-susp">Motivo</label>
      <textarea id="motivo-susp" className="rs-in" rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
      <ErrorNote error={suspender.error} style={{ marginTop: 12 }} />
    </Modal>
  );
}

function CrearOrg({ onClose }: { onClose: () => void }) {
  const plans = usePlatformQuery<PlanLite[]>('/v1/platform/plans');
  const [f, setF] = useState({ name: '', slug: '', ownerName: '', ownerEmail: '', planCode: '' });
  const [slugTocado, setSlugTocado] = useState(false);
  const crear = usePlatformMutation<void>((_, req) =>
    req('/v1/platform/orgs', { body: { name: f.name.trim(), slug: f.slug, ownerName: f.ownerName.trim(), ownerEmail: f.ownerEmail.trim(), ...(f.planCode && { planCode: f.planCode }) } }),
  );
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((cur) => ({ ...cur, [k]: e.target.value }));
  return (
    <Modal
      title="Crear organización"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="rs-btn rs-btn--secundario" onClick={onClose}>Cancelar</button>
          <button type="submit" form="crear-org" className="rs-btn rs-btn--primario" disabled={crear.isPending}>{crear.isPending ? 'Creando…' : 'Crear e invitar'}</button>
        </>
      }
    >
      <form
        id="crear-org"
        className="stack"
        style={{ gap: 12 }}
        onSubmit={(e) => {
          e.preventDefault();
          crear.mutate(undefined, { onSuccess: onClose });
        }}
      >
        <div>
          <label className="rs-label" htmlFor="co-nombre">Nombre del negocio</label>
          <input id="co-nombre" className="rs-in" required value={f.name} onChange={(e) => setF((c) => ({ ...c, name: e.target.value, slug: slugTocado ? c.slug : slugify(e.target.value) }))} />
        </div>
        <div>
          <label className="rs-label" htmlFor="co-slug">Enlace</label>
          <input id="co-slug" className="rs-in rs-mono" required value={f.slug} onChange={(e) => { setSlugTocado(true); setF((c) => ({ ...c, slug: slugify(e.target.value) })); }} />
          <p className="rs-help">rifastar.co/{f.slug || 'negocio'}</p>
        </div>
        <div>
          <label className="rs-label" htmlFor="co-owner">Nombre del propietario</label>
          <input id="co-owner" className="rs-in" required value={f.ownerName} onChange={set('ownerName')} />
        </div>
        <div>
          <label className="rs-label" htmlFor="co-email">Correo del propietario</label>
          <input id="co-email" type="email" className="rs-in" required value={f.ownerEmail} onChange={set('ownerEmail')} />
          <p className="rs-help">Le llega una invitación para crear su contraseña.</p>
        </div>
        <div>
          <label className="rs-label" htmlFor="co-plan">Plan</label>
          <select id="co-plan" className="rs-in" value={f.planCode} onChange={set('planCode')}>
            <option value="">Prueba gratis (configuración actual)</option>
            {(plans.data ?? []).filter((p) => !p.archivedAt).map((p) => <option key={p.id} value={p.code}>{p.name}</option>)}
          </select>
        </div>
        <ErrorNote error={crear.error} />
      </form>
    </Modal>
  );
}

export default function Organizaciones() {
  const { can } = usePlatform();
  const [filtro, setFiltro] = useState<OrgStatus | 'todas'>('todas');
  const [busqueda, setBusqueda] = useState('');
  const [q, setQ] = useState('');
  const [cursor, setCursor] = useState<string | null>(null);
  const [soporte, setSoporte] = useState<OrgRow | null>(null);
  const [suspender, setSuspender] = useState<OrgRow | null>(null);
  const [crear, setCrear] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => setQ(busqueda.trim()), 300);
    return () => window.clearTimeout(t);
  }, [busqueda]);
  useEffect(() => setCursor(null), [filtro, q]);

  const params = new URLSearchParams();
  if (filtro !== 'todas') params.set('status', filtro);
  if (q) params.set('q', q);
  if (cursor) params.set('cursor', cursor);
  const stats = usePlatformQuery<Stats>('/v1/platform/stats');
  const list = usePlatformQuery<{ items: OrgRow[]; nextCursor: string | null }>(`/v1/platform/orgs?${params}`);
  const reactivar = usePlatformMutation<string>((id, req) => req(`/v1/platform/orgs/${id}/reactivate`, { method: 'POST' }));
  const s = stats.data;

  return (
    <>
      <PageHeader
        title="Organizaciones"
        sub="Cada organizador es una cuenta independiente con su equipo, sus sorteos y su plan."
        actions={
          can('platform.orgs.write') && (
            <button type="button" className="rs-btn rs-btn--primario" onClick={() => setCrear(true)}>
              <Icon name="plus" size={18} strokeWidth={2.4} />
              Crear organización
            </button>
          )
        }
      />

      <section aria-label="Resumen" className="kpis">
        <div className="rs-panel kpi">
          <span className="kpi__label">Organizaciones activas</span>
          <span className="kpi__value">{s?.organizations.active ?? '–'}</span>
          <span className="kpi__note">de {s?.organizations.total ?? '–'} en total</span>
        </div>
        <div className="rs-panel kpi">
          <span className="kpi__label">En prueba gratis</span>
          <span className="kpi__value">{s?.organizations.trial ?? '–'}</span>
          <span className="kpi__note">{s?.organizations.suspended ?? 0} suspendidas</span>
        </div>
        {s?.mrrCop !== undefined && (
          <div className="rs-panel kpi">
            <span className="kpi__label">Ingreso mensual (MRR)</span>
            <span className="kpi__value">{cop(s.mrrCop)}</span>
            <span className="kpi__note">suscripciones activas y en mora</span>
          </div>
        )}
        <div className="rs-panel kpi">
          <span className="kpi__label">Pagos fallidos (30 días)</span>
          <span className="kpi__value" style={{ color: s?.failedPayments30d ? 'var(--rojo-texto)' : undefined }}>{s?.failedPayments30d ?? '–'}</span>
          {can('platform.billing.read') && <Link to="/plataforma/facturacion" className="small-link">Revisar</Link>}
        </div>
      </section>

      <section className="rs-panel overflow-hidden">
        <div className="panel-head">
          <div className="chips">
            {FILTROS.map((x) => (
              <button key={x.id} type="button" className="rs-chip" aria-pressed={filtro === x.id} onClick={() => setFiltro(x.id)}>
                {x.label}
              </button>
            ))}
          </div>
          <input
            className="rs-in"
            placeholder="Buscar por nombre o enlace"
            aria-label="Buscar organización"
            style={{ width: 300, maxWidth: '100%' }}
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
          />
        </div>
        {list.isLoading && <Loading />}
        <ErrorNote error={list.error ?? reactivar.error} style={{ margin: 16 }} />
        {list.data && (
          <div className="table-scroll">
            <table className="rs-tabla" style={{ minWidth: 960 }}>
              <thead>
                <tr>
                  <th>Organización</th><th>Propietario</th><th>Plan</th><th>Sorteos activos</th><th>Último acceso</th><th>Estado</th>
                  <th style={{ textAlign: 'right' }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {list.data.items.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <b>{o.name}</b><br />
                      <a href={`/${o.slug}`} target="_blank" rel="noreferrer" className="rs-mono cell-sub" style={{ fontSize: 13 }}>{o.slug}</a>
                    </td>
                    <td>{o.owner ? <>{o.owner.name}<br /><span className="cell-sub">{o.owner.email}</span></> : <span className="cell-sub">—</span>}</td>
                    <td>
                      <span style={{ fontWeight: 700 }}>{o.plan?.name ?? '—'}</span>
                      {o.status === 'trial' && o.trialEndsAt && <><br /><span className="cell-sub">vence {formatDay(o.trialEndsAt)}</span></>}
                    </td>
                    <td className="rs-mono">{o.activeRaffles}</td>
                    <td className="cell-sub">{o.lastAccessAt ? timeAgo(o.lastAccessAt) : 'Nunca'}</td>
                    <td><Badge tono={ESTADO[o.status].tono}>{ESTADO[o.status].label}</Badge></td>
                    <td className="td-right" style={{ whiteSpace: 'nowrap' }}>
                      {can('platform.impersonate') && (
                        <button type="button" className="rs-btn rs-btn--secundario rs-btn--sm" onClick={() => setSoporte(o)}>Entrar como soporte</button>
                      )}
                      {can('platform.orgs.write') &&
                        (o.status === 'suspended' ? (
                          <button type="button" className="rs-btn rs-btn--fantasma rs-btn--sm" disabled={reactivar.isPending} onClick={() => reactivar.mutate(o.id)}>Reactivar</button>
                        ) : (
                          <button type="button" className="rs-btn rs-btn--fantasma rs-btn--sm" style={{ color: 'var(--rojo-texto)' }} onClick={() => setSuspender(o)}>Suspender</button>
                        ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {list.data.items.length === 0 && <Empty>Ninguna organización coincide.</Empty>}
          </div>
        )}
        {(cursor || list.data?.nextCursor) && (
          <div className="panel-foot" style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            {cursor && <button type="button" className="rs-btn rs-btn--secundario rs-btn--sm" onClick={() => setCursor(null)}>Volver al inicio</button>}
            {list.data?.nextCursor && <button type="button" className="rs-btn rs-btn--secundario rs-btn--sm" onClick={() => setCursor(list.data!.nextCursor)}>Siguientes</button>}
          </div>
        )}
      </section>

      <p className="info-line">
        <Icon name="info" size={16} />
        «Entrar como soporte» abre la cuenta en modo lectura, con aviso visible para el organizador, y queda en el registro de actividad.
      </p>

      {soporte && <EntrarSoporte org={soporte} onClose={() => setSoporte(null)} />}
      {suspender && <Suspender org={suspender} onClose={() => setSuspender(null)} />}
      {crear && <CrearOrg onClose={() => setCrear(false)} />}
    </>
  );
}
