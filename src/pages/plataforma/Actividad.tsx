import { useState } from 'react';
import { usePlatformQuery } from '@/api/hooks';
import { PageHeader } from '@/components/PageHeader';
import { Empty, ErrorNote, Loading, Modal } from '@/components/ui';
import './plataforma.css';

interface AuditRow {
  id: string;
  actorType: 'platform_user' | 'user' | 'participant' | 'system';
  actorId: string | null;
  actorLabel: string | null;
  organizationId: string | null;
  supportSessionId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  ip: string | null;
  createdAt: string;
}

const ACTORES = { platform_user: 'Plataforma', user: 'Organizador', participant: 'Participante', system: 'Sistema' } as const;

const fecha = (iso: string) =>
  new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));

export default function Actividad() {
  const [f, setF] = useState({ action: '', actorType: '', organizationId: '', from: '', to: '' });
  const [aplicados, setAplicados] = useState(f);
  const [cursores, setCursores] = useState<string[]>([]);
  const [detalle, setDetalle] = useState<AuditRow | null>(null);

  const params = new URLSearchParams({ limit: '50' });
  if (aplicados.action) params.set('action', aplicados.action);
  if (aplicados.actorType) params.set('actorType', aplicados.actorType);
  if (aplicados.organizationId) params.set('organizationId', aplicados.organizationId);
  if (aplicados.from) params.set('from', new Date(`${aplicados.from}T00:00:00`).toISOString());
  if (aplicados.to) params.set('to', new Date(`${aplicados.to}T23:59:59`).toISOString());
  const cursor = cursores[cursores.length - 1];
  if (cursor) params.set('cursor', cursor);
  const logs = usePlatformQuery<{ items: AuditRow[]; nextCursor: string | null }>(`/v1/platform/audit-logs?${params}`);

  const uuidOk = !f.organizationId || /^[0-9a-f-]{36}$/i.test(f.organizationId.trim());

  return (
    <>
      <PageHeader title="Registro de actividad" sub="Quién hizo qué y cuándo, en toda la plataforma. Incluye las sesiones de soporte." />

      <form
        className="rs-panel"
        style={{ padding: 16, display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}
        onSubmit={(e) => {
          e.preventDefault();
          setCursores([]);
          setAplicados({ ...f, organizationId: f.organizationId.trim() });
        }}
      >
        <div>
          <label className="rs-label" htmlFor="a-accion">Acción (empieza por)</label>
          <input id="a-accion" className="rs-in rs-mono" placeholder="order.approve" value={f.action} onChange={(e) => setF({ ...f, action: e.target.value })} style={{ width: 200 }} />
        </div>
        <div>
          <label className="rs-label" htmlFor="a-actor">Quién</label>
          <select id="a-actor" className="rs-in" value={f.actorType} onChange={(e) => setF({ ...f, actorType: e.target.value })} style={{ width: 170 }}>
            <option value="">Todos</option>
            {Object.entries(ACTORES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div>
          <label className="rs-label" htmlFor="a-org">Id de organización</label>
          <input id="a-org" className="rs-in rs-mono" value={f.organizationId} onChange={(e) => setF({ ...f, organizationId: e.target.value })} style={{ width: 300 }} aria-invalid={!uuidOk} />
        </div>
        <div>
          <label className="rs-label" htmlFor="a-desde">Desde</label>
          <input id="a-desde" type="date" className="rs-in" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} />
        </div>
        <div>
          <label className="rs-label" htmlFor="a-hasta">Hasta</label>
          <input id="a-hasta" type="date" className="rs-in" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} />
        </div>
        <button type="submit" className="rs-btn rs-btn--primario" disabled={!uuidOk}>Filtrar</button>
      </form>

      <section className="rs-panel overflow-hidden">
        {logs.isLoading && <Loading />}
        <ErrorNote error={logs.error} style={{ margin: 16 }} />
        {logs.data && (
          <div className="table-scroll">
            <table className="rs-tabla" style={{ minWidth: 900 }}>
              <thead><tr><th>Fecha</th><th>Quién</th><th>Acción</th><th>Sobre</th><th>Organización</th></tr></thead>
              <tbody>
                {logs.data.items.map((r) => (
                  <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => setDetalle(r)}>
                    <td className="cell-sub" style={{ whiteSpace: 'nowrap' }}>{fecha(r.createdAt)}</td>
                    <td>
                      <b>{r.actorLabel ?? ACTORES[r.actorType]}</b>
                      {r.supportSessionId && <><br /><span className="cell-sub">en sesión de soporte</span></>}
                    </td>
                    <td className="rs-mono">{r.action}</td>
                    <td className="cell-sub">{r.entityType}{r.entityId ? ` · ${r.entityId.slice(0, 8)}` : ''}</td>
                    <td className="rs-mono cell-sub">{r.organizationId ? r.organizationId.slice(0, 8) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {logs.data.items.length === 0 && <Empty>Sin actividad con esos filtros.</Empty>}
          </div>
        )}
        {(cursores.length > 0 || logs.data?.nextCursor) && (
          <div className="panel-foot" style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            {cursores.length > 0 && <button type="button" className="rs-btn rs-btn--secundario rs-btn--sm" onClick={() => setCursores((c) => c.slice(0, -1))}>Más recientes</button>}
            {logs.data?.nextCursor && <button type="button" className="rs-btn rs-btn--secundario rs-btn--sm" onClick={() => setCursores((c) => [...c, logs.data!.nextCursor!])}>Más antiguos</button>}
          </div>
        )}
      </section>

      {detalle && (
        <Modal title={detalle.action} onClose={() => setDetalle(null)}>
          <dl className="stack" style={{ gap: 6, margin: 0, font: '500 14px/20px var(--font-sans)' }}>
            <div><b>Fecha:</b> {fecha(detalle.createdAt)}</div>
            <div><b>Quién:</b> {detalle.actorLabel ?? ACTORES[detalle.actorType]} {detalle.actorId && <span className="rs-mono cell-sub">{detalle.actorId}</span>}</div>
            <div><b>Sobre:</b> {detalle.entityType} <span className="rs-mono cell-sub">{detalle.entityId}</span></div>
            {detalle.organizationId && <div><b>Organización:</b> <span className="rs-mono">{detalle.organizationId}</span></div>}
            {detalle.ip && <div><b>IP:</b> <span className="rs-mono">{detalle.ip}</span></div>}
          </dl>
          {detalle.before != null && (
            <>
              <h3 className="eyebrow" style={{ marginTop: 12 }}>Antes</h3>
              <pre className="rs-mono" style={{ whiteSpace: 'pre-wrap', fontSize: 12, background: 'var(--superficie-alta)', padding: 10, borderRadius: 10 }}>{JSON.stringify(detalle.before, null, 2)}</pre>
            </>
          )}
          {detalle.after != null && (
            <>
              <h3 className="eyebrow" style={{ marginTop: 12 }}>Después</h3>
              <pre className="rs-mono" style={{ whiteSpace: 'pre-wrap', fontSize: 12, background: 'var(--superficie-alta)', padding: 10, borderRadius: 10 }}>{JSON.stringify(detalle.after, null, 2)}</pre>
            </>
          )}
        </Modal>
      )}
    </>
  );
}
