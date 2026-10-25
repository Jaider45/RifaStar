import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { usePlatform } from '@/api/platform-session';
import { useSession } from '@/api/session';
import { Loading } from './ui';

/** Panel de organización: exige sesión (o sesión de soporte). */
export function RequireOrgSession() {
  const { status, me } = useSession();
  const location = useLocation();
  if (status === 'loading') return <Loading />;
  if (status === 'anon') return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (status === 'user' && me && me.memberships.length === 0) {
    return (
      <div className="rs-claro acceso">
        <div className="rs-panel acceso__caja">
          <h1 className="h2">No perteneces a ninguna organización</h1>
          <p className="rs-help">Pide que te inviten o crea la tuya.</p>
        </div>
      </div>
    );
  }
  return <Outlet />;
}

export function RequirePlatform() {
  const { status } = usePlatform();
  if (status === 'loading') return <Loading />;
  if (status === 'anon') return <Navigate to="/plataforma/login" replace />;
  return <Outlet />;
}
