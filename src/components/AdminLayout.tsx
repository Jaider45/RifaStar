import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useCan, useOrgProfile, useOrgQuery } from '@/api/hooks';
import { useSession } from '@/api/session';
import { initials } from '@/lib/phone';
import { formatTime } from '@/lib/time';
import { Icon, type IconName } from './Icon';
import { Logo } from './Logo';

const NAV: { to: string; label: string; icon: IconName; end?: boolean; permission: string }[] = [
  { to: '/admin', label: 'Mis sorteos', icon: 'grid', end: true, permission: 'raffles.view' },
  { to: '/admin/sorteos/nuevo', label: 'Constructor', icon: 'pencil', permission: 'raffles.edit' },
  { to: '/admin/pagos', label: 'Pagos', icon: 'card', permission: 'payments.view' },
  { to: '/admin/ganadores', label: 'Ganadores', icon: 'trophy', permission: 'raffles.view' },
  { to: '/admin/ranking', label: 'Ranking', icon: 'chart', permission: 'raffles.view' },
  { to: '/admin/ventas', label: 'Mis ventas', icon: 'ticket', permission: 'sales.view_own' },
  { to: '/admin/participantes', label: 'Participantes', icon: 'search', permission: 'participants.view_contact' },
  { to: '/admin/ajustes', label: 'Ajustes', icon: 'sliders', permission: 'raffles.view' },
];

const ROLE_LABELS: Record<string, string> = {
  owner: 'Propietario',
  admin: 'Administrador',
  payment_verifier: 'Verificador de pagos',
  seller: 'Vendedor',
};

/** Panel del organizador: menú lateral claro + contenido. */
export function AdminLayout() {
  const session = useSession();
  const navigate = useNavigate();
  const { data: org } = useOrgProfile();
  const can = useCan();
  const viewerPerms = org?.viewer.permissions ?? [];
  const { data: dash } = useOrgQuery<{ pendingPayments: number }>(viewerPerms.includes('payments.view') ? '/v1/dashboard' : null, {
    refetchInterval: 60_000,
  });
  const pendientes = dash?.pendingPayments ?? 0;
  const membership = session.me?.memberships.find((m) => m.organization.id === session.activeOrgId);
  const status = session.accountStatus ?? org?.status;

  return (
    <div className="rs-claro">
      {session.support && (
        <div className="aviso-soporte" role="status">
          Estás viendo «{session.support.organizationName}» como soporte, en modo lectura, hasta las {formatTime(session.support.expiresAt)}.
          <button
            type="button"
            className="rs-btn rs-btn--secundario rs-btn--sm"
            onClick={() => {
              session.endSupport();
              navigate('/plataforma');
            }}
          >
            Salir del modo soporte
          </button>
        </div>
      )}
      {!session.support && session.supportActiveUntil && (
        <div className="aviso-soporte" role="status">
          El equipo de soporte de Rifa Star está revisando tu cuenta (solo lectura) hasta las {formatTime(session.supportActiveUntil)}.
        </div>
      )}
      {status === 'past_due' && (
        <div className="aviso-cuenta" role="status">
          Tu pago está vencido. Actualízalo en Ajustes › Plan y facturación para evitar la suspensión.
        </div>
      )}
      {status === 'suspended' && (
        <div className="aviso-cuenta" role="alert">
          Tu cuenta está suspendida: puedes consultar, pero no hacer cambios ni vender. Revisa Ajustes › Plan y facturación.
        </div>
      )}
      <div className="shell">
        <nav aria-label="Menú principal" className="sidebar">
          <Logo variante="negro" className="sidebar__logo" />
          {can('raffles.edit') && (
            <NavLink to="/admin/sorteos/nuevo" className="rs-btn rs-btn--primario sidebar__new" style={{ width: '100%' }}>
              <Icon name="plus" size={18} strokeWidth={2.4} />
              Nuevo sorteo
            </NavLink>
          )}
          {session.me && session.me.memberships.length > 1 && !session.support && (
            <select
              className="rs-in org-switch"
              aria-label="Organización"
              value={session.activeOrgId ?? ''}
              onChange={(e) => {
                session.setActiveOrg(e.target.value);
                navigate('/admin');
              }}
            >
              {session.me.memberships.map((m) => (
                <option key={m.organization.id} value={m.organization.id}>{m.organization.name}</option>
              ))}
            </select>
          )}
          <div className="rs-nav sidebar__nav">
            {NAV.filter((item) => viewerPerms.includes(item.permission)).map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end}>
                <Icon name={item.icon} />
                {item.icon === 'card' ? (
                  <>
                    <span style={{ flex: 1 }}>{item.label}</span>
                    {pendientes > 0 && (
                      <span className="rs-badge rs-badge--urgente" aria-label={`${pendientes} por verificar`}>{pendientes}</span>
                    )}
                  </>
                ) : (
                  item.label
                )}
              </NavLink>
            ))}
          </div>
          <div className="sidebar__user">
            <div aria-hidden="true" className="avatar">{initials(session.me?.name ?? org?.name ?? 'RS')}</div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="sidebar__user-name">{session.support ? 'Soporte Rifa Star' : session.me?.name}</div>
              <div className="sidebar__user-role">
                {session.support ? 'Solo lectura' : (membership && (ROLE_LABELS[membership.role.key] ?? membership.role.name))}
                {org && ` · ${org.name}`}
              </div>
            </div>
            {!session.support && (
              <button
                type="button"
                className="rs-btn rs-btn--fantasma rs-btn--sm"
                aria-label="Cerrar sesión"
                title="Cerrar sesión"
                onClick={async () => {
                  await session.logout();
                  navigate('/login');
                }}
              >
                Salir
              </button>
            )}
          </div>
        </nav>
        <main className="main">
          <div className="main__inner">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
