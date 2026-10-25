import { Navigate, Route, Routes } from 'react-router-dom';
import { AdminLayout } from '@/components/AdminLayout';
import { PlataformaLayout } from '@/components/PlataformaLayout';
import { PagosProvider } from '@/data/PagosContext';
import Ajustes from '@/pages/admin/Ajustes';
import Constructor from '@/pages/admin/Constructor';
import Ganador from '@/pages/admin/Ganador';
import Pagos from '@/pages/admin/Pagos';
import Ranking from '@/pages/admin/Ranking';
import Sorteos from '@/pages/admin/Sorteos';
import Pendiente from '@/pages/Pendiente';
import Organizaciones from '@/pages/plataforma/Organizaciones';
import Planes from '@/pages/plataforma/Planes';
import Roles from '@/pages/plataforma/Roles';
import Agotado from '@/pages/publico/Agotado';
import Boletos from '@/pages/publico/Boletos';
import Pago from '@/pages/publico/Pago';
import RankingPublico from '@/pages/publico/RankingPublico';
import Venta from '@/pages/publico/Venta';

export default function App() {
  return (
    <PagosProvider>
      <Routes>
        <Route path="/" element={<Navigate to="/admin" replace />} />

        {/* Panel del organizador (cliente del SaaS) */}
        <Route path="/admin" element={<AdminLayout />}>
          <Route index element={<Sorteos />} />
          <Route path="sorteos/nuevo" element={<Constructor />} />
          <Route path="pagos" element={<Pagos />} />
          <Route path="ganadores" element={<Ganador />} />
          <Route path="ranking" element={<Ranking />} />
          <Route path="ajustes" element={<Ajustes />} />
        </Route>

        {/* Enlaces públicos (móvil) */}
        <Route path="/s/:slug" element={<Venta />} />
        <Route path="/s/:slug/pagar" element={<Pago />} />
        <Route path="/s/:slug/resultado" element={<Agotado />} />
        <Route path="/mis-boletos" element={<Boletos />} />
        <Route path="/r/:org" element={<RankingPublico />} />

        {/* Super admin de la plataforma */}
        <Route path="/plataforma" element={<PlataformaLayout />}>
          <Route index element={<Organizaciones />} />
          <Route path="planes" element={<Planes />} />
          <Route path="roles" element={<Roles />} />
          <Route path="facturacion" element={<Pendiente titulo="Facturación" />} />
          <Route path="actividad" element={<Pendiente titulo="Registro de actividad" />} />
        </Route>

        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Routes>
    </PagosProvider>
  );
}
