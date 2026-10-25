import { NavLink, Outlet } from 'react-router-dom';
import { Icon, type IconName } from './Icon';
import { Logo } from './Logo';

const NAV: { to: string; label: string; icon: IconName; end?: boolean }[] = [
  { to: '/plataforma', label: 'Organizaciones', icon: 'building', end: true },
  { to: '/plataforma/planes', label: 'Planes', icon: 'layers' },
  { to: '/plataforma/roles', label: 'Roles y permisos', icon: 'shield' },
  // Facturación y Registro de actividad aún no tienen pantalla propia en el diseño.
  { to: '/plataforma/facturacion', label: 'Facturación', icon: 'card' },
  { to: '/plataforma/actividad', label: 'Registro de actividad', icon: 'log' },
];

/** Super admin de la plataforma: menú lateral negro con la etiqueta "Plataforma". */
export function PlataformaLayout() {
  return (
    <div className="rs-claro shell">
      <nav aria-label="Menú de la plataforma" className="sidebar sidebar--plataforma">
        <div className="sidebar__brand">
          <Logo variante="blanco" className="sidebar__logo" />
          <span className="tag-plataforma">Plataforma</span>
        </div>
        <div className="pnav sidebar__nav">
          {NAV.map((item) => (
            <NavLink key={item.label} to={item.to} end={item.end}>
              <Icon name={item.icon} />
              {item.label}
            </NavLink>
          ))}
        </div>
        <div className="sidebar__user">
          <div aria-hidden="true" className="avatar">JR</div>
          <div>
            <div className="sidebar__user-name">Jaideer</div>
            <div className="sidebar__user-role">Super admin</div>
          </div>
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
