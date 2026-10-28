import { lazy, Suspense } from 'react';
import { Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { PlatformSessionProvider } from '@/api/platform-session';
import { SessionProvider } from '@/api/session';
import { AdminLayout } from '@/components/AdminLayout';
import { RequireOrgSession, RequirePlatform } from '@/components/guards';
import { PlataformaLayout } from '@/components/PlataformaLayout';
import { Loading } from '@/components/ui';

// Cada página en su propio archivo: quien abre un enlace público desde WhatsApp no descarga el panel.
const Invitacion = lazy(() => import('@/pages/acceso/Acceso').then((m) => ({ default: m.Invitacion })));
const Login = lazy(() => import('@/pages/acceso/Acceso').then((m) => ({ default: m.Login })));
const Olvide = lazy(() => import('@/pages/acceso/Acceso').then((m) => ({ default: m.Olvide })));
const Registro = lazy(() => import('@/pages/acceso/Acceso').then((m) => ({ default: m.Registro })));
const Restablecer = lazy(() => import('@/pages/acceso/Acceso').then((m) => ({ default: m.Restablecer })));
const PlataformaLogin = lazy(() => import('@/pages/acceso/PlataformaLogin'));
const Ajustes = lazy(() => import('@/pages/admin/Ajustes'));
const Comprobantes = lazy(() => import('@/pages/admin/Comprobantes'));
const Constructor = lazy(() => import('@/pages/admin/Constructor'));
const Ganador = lazy(() => import('@/pages/admin/Ganador'));
const Pagos = lazy(() => import('@/pages/admin/Pagos'));
const Participantes = lazy(() => import('@/pages/admin/Participantes'));
const Ranking = lazy(() => import('@/pages/admin/Ranking'));
const Sorteos = lazy(() => import('@/pages/admin/Sorteos'));
const Ventas = lazy(() => import('@/pages/admin/Ventas'));
const Actividad = lazy(() => import('@/pages/plataforma/Actividad'));
const Facturacion = lazy(() => import('@/pages/plataforma/Facturacion'));
const Organizaciones = lazy(() => import('@/pages/plataforma/Organizaciones'));
const Planes = lazy(() => import('@/pages/plataforma/Planes'));
const Roles = lazy(() => import('@/pages/plataforma/Roles'));
const Agotado = lazy(() => import('@/pages/publico/Agotado'));
const Boletos = lazy(() => import('@/pages/publico/Boletos'));
const OrgPublica = lazy(() => import('@/pages/publico/OrgPublica'));
const Pago = lazy(() => import('@/pages/publico/Pago'));
const RankingPublico = lazy(() => import('@/pages/publico/RankingPublico'));
const Venta = lazy(() => import('@/pages/publico/Venta'));

/** Sesión del panel solo donde se usa (las páginas públicas no la necesitan). */
const OrgSession = () => (
  <SessionProvider>
    <Outlet />
  </SessionProvider>
);
const PlatformSession = () => (
  <PlatformSessionProvider>
    <Outlet />
  </PlatformSessionProvider>
);

export default function App() {
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route path="/" element={<Navigate to="/admin" replace />} />

        <Route element={<OrgSession />}>
          <Route path="/login" element={<Login />} />
          <Route path="/registro" element={<Registro />} />
          <Route path="/invitacion/:token" element={<Invitacion />} />
          <Route path="/olvide" element={<Olvide />} />
          <Route path="/restablecer/:token" element={<Restablecer />} />

          {/* Panel del organizador (cliente del SaaS) */}
          <Route element={<RequireOrgSession />}>
            <Route path="/admin" element={<AdminLayout />}>
              <Route index element={<Sorteos />} />
              <Route path="sorteos/nuevo" element={<Constructor />} />
              <Route path="sorteos/:id" element={<Constructor />} />
              <Route path="pagos" element={<Pagos />} />
              <Route path="ganadores" element={<Ganador />} />
              <Route path="ganadores/:id" element={<Ganador />} />
              <Route path="ranking" element={<Ranking />} />
              <Route path="ventas" element={<Ventas />} />
              <Route path="participantes" element={<Participantes />} />
              <Route path="ajustes" element={<Ajustes />} />
              <Route path="comprobantes" element={<Comprobantes />} />
              <Route path="comprobantes/:id" element={<Comprobantes />} />
            </Route>
          </Route>

          {/* Super admin de la plataforma (usa además la sesión de org para «entrar como soporte») */}
          <Route element={<PlatformSession />}>
            <Route path="/plataforma/login" element={<PlataformaLogin />} />
            <Route element={<RequirePlatform />}>
              <Route path="/plataforma" element={<PlataformaLayout />}>
                <Route index element={<Organizaciones />} />
                <Route path="planes" element={<Planes />} />
                <Route path="roles" element={<Roles />} />
                <Route path="facturacion" element={<Facturacion />} />
                <Route path="actividad" element={<Actividad />} />
              </Route>
            </Route>
          </Route>
        </Route>

        {/* Enlaces públicos: rifastar.co/{org}/{sorteo} (móvil) */}
        <Route path="/:org" element={<OrgPublica />} />
        <Route path="/:org/mis-boletos" element={<Boletos />} />
        <Route path="/:org/ranking" element={<RankingPublico />} />
        <Route path="/:org/:sorteo" element={<Venta />} />
        <Route path="/:org/:sorteo/pagar" element={<Pago />} />
        <Route path="/:org/:sorteo/resultado" element={<Agotado />} />

        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Routes>
    </Suspense>
  );
}
