import { Fragment, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { usePlatformMutation, usePlatformQuery } from '@/api/hooks';
import { usePlatform } from '@/api/platform-session';
import { Badge, type BadgeTono } from '@/components/Badge';
import { Icon } from '@/components/Icon';
import { PageHeader } from '@/components/PageHeader';
import { ErrorNote, Loading, Modal, OkNote } from '@/components/ui';
import { timeAgo } from '@/lib/time';
import './plataforma.css';

interface PermissionDef { key: string; group: string; description: string }
interface Catalog { organization: PermissionDef[]; platform: PermissionDef[] }
interface RoleTemplate { key: string; name: string; description: string | null; locked: boolean; permissions: string[] }
type PlatformRole = 'super_admin' | 'support' | 'finance';
interface Team {
  members: { id: string; email: string; name: string; role: PlatformRole; twoFactorEnabled: boolean; lastLoginAt: string | null; disabled: boolean }[];
  roles: { role: PlatformRole; locked: boolean; permissions: string[] }[];
}

const ROL_PLAT: Record<PlatformRole, { label: string; tono: BadgeTono; desc: string }> = {
  super_admin: { label: 'Super admin', tono: 'ganador', desc: 'Todo: organizaciones, planes, precios, roles, facturación y suspender cuentas.' },
  support: { label: 'Soporte', tono: 'abierto', desc: 'Ve organizaciones y entra como soporte en modo lectura. No toca precios ni pagos.' },
  finance: { label: 'Finanzas', tono: 'cerrado', desc: 'Facturación, cobros fallidos y suscripciones. Sin acceso a sorteos.' },
};

/** Matriz permiso × rol con casillas; guarda solo las columnas que cambiaron. */
function Matriz({
  catalogo,
  columnas,
  onSave,
  pie,
}: {
  catalogo: PermissionDef[];
  columnas: { id: string; label: string; locked: boolean; permissions: string[] }[];
  onSave: (cambios: { id: string; permissions: string[] }[]) => Promise<unknown>;
  pie: string;
}) {
  const [m, setM] = useState<Record<string, Set<string>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [ok, setOk] = useState(false);
  useEffect(() => setM(Object.fromEntries(columnas.map((c) => [c.id, new Set(c.permissions)]))), [columnas]);

  const cambios = columnas.filter((c) => {
    const s = m[c.id];
    return s && !c.locked && (s.size !== c.permissions.length || c.permissions.some((p) => !s.has(p)));
  });
  const grupos = [...new Set(catalogo.map((p) => p.group))];
  const toggle = (col: string, key: string) => {
    setOk(false);
    setM((cur) => {
      const s = new Set(cur[col]);
      if (s.has(key)) s.delete(key);
      else s.add(key);
      return { ...cur, [col]: s };
    });
  };
  const guardar = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSave(cambios.map((c) => ({ id: c.id, permissions: [...m[c.id]] })));
      setOk(true);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="table-scroll">
        <table className="rs-tabla" style={{ minWidth: 760 }}>
          <thead>
            <tr>
              <th style={{ width: '40%' }}>Permiso</th>
              {columnas.map((c) => <th key={c.id} className="td-center">{c.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {grupos.map((g) => (
              <Fragment key={g}>
                <tr className="fila-grupo">
                  <td colSpan={columnas.length + 1}><b className="eyebrow">{g}</b></td>
                </tr>
                {catalogo.filter((p) => p.group === g).map((p) => (
                  <tr key={p.key}>
                    <td><span style={{ fontWeight: 600 }}>{p.description}</span></td>
                    {columnas.map((c) => (
                      <td key={c.id} className="td-center">
                        <input
                          type="checkbox"
                          className="check"
                          checked={c.locked || Boolean(m[c.id]?.has(p.key))}
                          disabled={c.locked}
                          onChange={() => toggle(c.id, p.key)}
                          aria-label={`${p.description} · ${c.label}`}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <div className="panel-foot stack" style={{ gap: 10 }}>
        <span>{pie}</span>
        <ErrorNote error={error} />
        {ok && <OkNote>Permisos guardados.</OkNote>}
        <div>
          <button type="button" className="rs-btn rs-btn--primario" disabled={cambios.length === 0 || busy} onClick={guardar}>
            {busy ? 'Guardando…' : cambios.length ? `Guardar cambios (${cambios.length} rol${cambios.length > 1 ? 'es' : ''})` : 'Sin cambios'}
          </button>
        </div>
      </div>
    </>
  );
}

function Invitar({ onClose }: { onClose: () => void }) {
  const [f, setF] = useState({ name: '', email: '', role: 'support' as PlatformRole });
  const invitar = usePlatformMutation<void>((_, req) => req('/v1/platform/team', { body: { name: f.name.trim(), email: f.email.trim(), role: f.role } }));
  return (
    <Modal
      title="Invitar al equipo de la plataforma"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="rs-btn rs-btn--secundario" onClick={onClose}>Cancelar</button>
          <button type="submit" form="inv-plat" className="rs-btn rs-btn--primario" disabled={invitar.isPending}>{invitar.isPending ? 'Invitando…' : 'Invitar'}</button>
        </>
      }
    >
      <form id="inv-plat" className="stack" style={{ gap: 12 }} onSubmit={(e) => { e.preventDefault(); invitar.mutate(undefined, { onSuccess: onClose }); }}>
        <div>
          <label className="rs-label" htmlFor="ip-nombre">Nombre</label>
          <input id="ip-nombre" className="rs-in" required minLength={2} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </div>
        <div>
          <label className="rs-label" htmlFor="ip-email">Correo</label>
          <input id="ip-email" type="email" className="rs-in" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        </div>
        <div>
          <label className="rs-label" htmlFor="ip-rol">Rol</label>
          <select id="ip-rol" className="rs-in" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as PlatformRole })}>
            {(Object.keys(ROL_PLAT) as PlatformRole[]).map((r) => <option key={r} value={r}>{ROL_PLAT[r].label}</option>)}
          </select>
        </div>
        <p className="rs-help">Le llega una contraseña temporal por correo. En su primer ingreso configura la verificación en dos pasos.</p>
        <ErrorNote error={invitar.error} />
      </form>
    </Modal>
  );
}

export default function Roles() {
  const { me, platformRequest } = usePlatform();
  const [nivel, setNivel] = useState<'org' | 'plat'>('org');
  const [invitar, setInvitar] = useState(false);
  const catalog = usePlatformQuery<Catalog>('/v1/platform/permission-catalog');
  const templates = usePlatformQuery<RoleTemplate[]>('/v1/platform/role-templates');
  const team = usePlatformQuery<Team>('/v1/platform/team');
  const actualizar = usePlatformMutation<{ id: string; role?: PlatformRole; disabled?: boolean }>(({ id, ...body }, req) => req(`/v1/platform/team/${id}`, { method: 'PATCH', body }));
  const qc = useQueryClient();

  if (catalog.isLoading || templates.isLoading || team.isLoading) return <Loading />;
  const error = catalog.error ?? templates.error ?? team.error;
  if (error || !catalog.data || !templates.data || !team.data) return <ErrorNote error={error} />;

  return (
    <>
      <PageHeader
        title="Roles y permisos"
        sub="Dos niveles: tu equipo que administra la plataforma, y la plantilla de roles que recibe cada organización."
        actions={
          nivel === 'plat' && (
            <button type="button" className="rs-btn rs-btn--primario" onClick={() => setInvitar(true)}>
              <Icon name="plus" size={18} strokeWidth={2.4} />
              Invitar
            </button>
          )
        }
      />

      <div role="tablist" aria-label="Nivel" className="segmento-claro">
        <button type="button" role="tab" aria-selected={nivel === 'org'} onClick={() => setNivel('org')}>Roles de organización</button>
        <button type="button" role="tab" aria-selected={nivel === 'plat'} onClick={() => setNivel('plat')}>Equipo de la plataforma</button>
      </div>

      {nivel === 'org' && (
        <section className="rs-panel overflow-hidden" role="tabpanel">
          <div className="panel-head">
            <div>
              <h2 className="h2">Roles de una organización</h2>
              <p className="rs-help">Plantilla que aplica a todas las organizaciones. Los roles personalizados de cada organización no cambian.</p>
            </div>
          </div>
          <Matriz
            catalogo={catalog.data.organization}
            columnas={templates.data.map((r) => ({ id: r.key, label: r.name, locked: r.locked, permissions: r.permissions }))}
            onSave={async (cambios) => {
              for (const c of cambios) await platformRequest(`/v1/platform/role-templates/${c.id}/permissions`, { method: 'PUT', body: { permissions: c.permissions } });
              await qc.invalidateQueries({ queryKey: ['platform'] });
            }}
            pie="El Propietario siempre tiene todos los permisos y es el único que puede borrar la cuenta. Cada organización puede crear roles propios si su plan lo incluye."
          />
        </section>
      )}

      {nivel === 'plat' && (
        <section className="stack" style={{ gap: 20 }} role="tabpanel">
          <section className="rs-panel overflow-hidden">
            <div className="panel-head">
              <h2 className="h2">Equipo de la plataforma</h2>
            </div>
            <ErrorNote error={actualizar.error} style={{ margin: 16 }} />
            <div className="table-scroll">
              <table className="rs-tabla" style={{ minWidth: 720 }}>
                <thead><tr><th>Persona</th><th>Rol</th><th>Verificación en dos pasos</th><th>Último acceso</th><th style={{ textAlign: 'right' }}>Acceso</th></tr></thead>
                <tbody>
                  {team.data.members.map((u) => {
                    const yo = u.id === me?.id;
                    return (
                      <tr key={u.id} style={u.disabled ? { opacity: 0.6 } : undefined}>
                        <td><b>{u.name}</b><br /><span className="cell-sub">{yo ? 'Tú · ' : ''}{u.email}</span></td>
                        <td>
                          {yo ? (
                            <Badge tono={ROL_PLAT[u.role].tono}>{ROL_PLAT[u.role].label}</Badge>
                          ) : (
                            <select className="rs-in" aria-label={`Rol de ${u.name}`} style={{ width: 180 }} value={u.role} disabled={actualizar.isPending} onChange={(e) => actualizar.mutate({ id: u.id, role: e.target.value as PlatformRole })}>
                              {(Object.keys(ROL_PLAT) as PlatformRole[]).map((r) => <option key={r} value={r}>{ROL_PLAT[r].label}</option>)}
                            </select>
                          )}
                        </td>
                        <td className={`dos-pasos dos-pasos--${u.twoFactorEnabled ? 'ok' : 'pendiente'}`}>{u.twoFactorEnabled ? 'Activa' : 'Pendiente'}</td>
                        <td>{u.lastLoginAt ? timeAgo(u.lastLoginAt) : 'Nunca'}</td>
                        <td className="td-right">
                          {!yo && (
                            <button type="button" className="rs-btn rs-btn--fantasma rs-btn--sm" disabled={actualizar.isPending} onClick={() => actualizar.mutate({ id: u.id, disabled: !u.disabled })}>
                              {u.disabled ? 'Reactivar' : 'Desactivar'}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rs-panel overflow-hidden">
            <div className="panel-head">
              <div>
                <h2 className="h2">Permisos por rol de la plataforma</h2>
                <p className="rs-help">{(Object.keys(ROL_PLAT) as PlatformRole[]).map((r) => `${ROL_PLAT[r].label}: ${ROL_PLAT[r].desc}`).join(' ')}</p>
              </div>
            </div>
            <Matriz
              catalogo={catalog.data.platform}
              columnas={team.data.roles.map((r) => ({ id: r.role, label: ROL_PLAT[r.role].label, locked: r.locked, permissions: r.permissions }))}
              onSave={async (cambios) => {
                for (const c of cambios) await platformRequest(`/v1/platform/role-permissions/${c.id}`, { method: 'PUT', body: { permissions: c.permissions } });
                await qc.invalidateQueries({ queryKey: ['platform'] });
              }}
              pie="El super admin siempre tiene todos los permisos. Los cambios aplican de inmediato."
            />
          </section>
        </section>
      )}

      {invitar && <Invitar onClose={() => setInvitar(false)} />}
    </>
  );
}
