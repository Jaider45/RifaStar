import { NavLink, Outlet } from 'react-router-dom';
import { Icon, type IconName } from './Icon';
import { Logo } from './Logo';
import { ORGANIZACION } from '@/data/mock';
import { usePagos } from '@/data/PagosContext';

const NAV: { to: string; label: string; icon: IconName; end?: boolean }[] = [
  { to: '/admin', label: 'Mis sorteos', icon: 'grid', end: true },
  { to: '/admin/sorteos/nuevo', label: 'Constructor', icon: 'pencil' },
  { to: '/admin/pagos', label: 'Pagos', icon: 'card' },
  { to: '/admin/ganadores', label: 'Ganadores', icon: 'trophy' },
  { to: '/admin/ranking', label: 'Ranking', icon: 'chart' },
  { to: '/admin/ajustes', label: 'Ajustes', icon: 'sliders' },
];

/** Panel del organizador: menú lateral claro + contenido. */
export function AdminLayout() {
  const { pendientes } = usePagos();

  return (
    <div className="rs-claro shell">
      <nav aria-label="Menú principal" className="sidebar">
        <Logo variante="negro" className="sidebar__logo" />
        <NavLink to="/admin/sorteos/nuevo" className="rs-btn rs-btn--primario sidebar__new" style={{ width: '100%' }}>
          <Icon name="plus" size={18} strokeWidth={2.4} />
          Nuevo sorteo
        </NavLink>
        <div className="rs-nav sidebar__nav">
          {NAV.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end}>
              <Icon name={item.icon} />
              {item.icon === 'card' ? (
                <>
                  <span style={{ flex: 1 }}>{item.label}</span>
                  {pendientes.length > 0 && (
                    <span className="rs-badge rs-badge--urgente" aria-label={`${pendientes.length} por verificar`}>
                      {pendientes.length}
                    </span>
                  )}
                </>
              ) : (
                item.label
              )}
            </NavLink>
          ))}
        </div>
        <div className="sidebar__user">
          <div aria-hidden="true" className="avatar">{ORGANIZACION.iniciales}</div>
          <div style={{ minWidth: 0 }}>
            <div className="sidebar__user-name">{ORGANIZACION.propietaria}</div>
            <div className="sidebar__user-role">Propietaria</div>
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
