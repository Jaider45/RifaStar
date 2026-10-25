import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { usePlatform } from '@/api/platform-session';
import { initials } from '@/lib/phone';
import { Icon, type IconName } from './Icon';
import { Logo } from './Logo';

const NAV: { to: string; label: string; icon: IconName; end?: boolean; permission: string }[] = [
  { to: '/plataforma', label: 'Organizaciones', icon: 'building', end: true, permission: 'platform.orgs.read' },
  { to: '/plataforma/planes', label: 'Planes', icon: 'layers', permission: 'platform.orgs.read' },
  { to: '/plataforma/roles', label: 'Roles y permisos', icon: 'shield', permission: 'platform.roles.write' },
  { to: '/plataforma/facturacion', label: 'Facturación', icon: 'card', permission: 'platform.billing.read' },
  { to: '/plataforma/actividad', label: 'Registro de actividad', icon: 'log', permission: 'platform.orgs.read' },
];

const ROLES = { super_admin: 'Super admin', support: 'Soporte', finance: 'Finanzas' } as const;

/** Super admin de la plataforma: menú lateral negro con la etiqueta "Plataforma". */
export function PlataformaLayout() {
  const { me, can, logout } = usePlatform();
  const navigate = useNavigate();
  return (
    <div className="rs-claro shell">
      <nav aria-label="Menú de la plataforma" className="sidebar sidebar--plataforma">
        <div className="sidebar__brand">
          <Logo variante="blanco" className="sidebar__logo" />
          <span className="tag-plataforma">Plataforma</span>
        </div>
        <div className="pnav sidebar__nav">
          {NAV.filter((i) => can(i.permission)).map((item) => (
            <NavLink key={item.label} to={item.to} end={item.end}>
              <Icon name={item.icon} />
              {item.label}
            </NavLink>
          ))}
        </div>
        <div className="sidebar__user">
          <div aria-hidden="true" className="avatar">{initials(me?.name ?? 'RS')}</div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="sidebar__user-name">{me?.name}</div>
            <div className="sidebar__user-role">{me ? ROLES[me.role] : ''}</div>
          </div>
          <button
            type="button"
            className="rs-btn rs-btn--fantasma rs-btn--sm"
            style={{ color: '#a6a5a1' }}
            onClick={async () => {
              await logout();
              navigate('/plataforma/login');
            }}
          >
            Salir
          </button>
        </div>
      </nav>
      <main className="main">
        <div className="main__inner">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
