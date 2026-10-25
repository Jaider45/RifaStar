import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, type BadgeTono } from '@/components/Badge';
import { DotsIcon, Icon } from '@/components/Icon';
import { PageHeader } from '@/components/PageHeader';
import { ORGANIZACIONES, type Organizacion } from '@/data/mock';

const FILTROS: { id: string; label: string; estado?: Organizacion['estado'][] }[] = [
  { id: 'todas', label: 'Todas' },
  { id: 'activas', label: 'Activas', estado: ['Activa', 'Pago fallido'] },
  { id: 'prueba', label: 'En prueba', estado: ['En prueba'] },
  { id: 'suspendidas', label: 'Suspendidas', estado: ['Suspendida'] },
];

const TONO: Record<Organizacion['estado'], BadgeTono> = {
  Activa: 'abierto',
  'Pago fallido': 'urgente',
  'En prueba': 'cerrado',
  Suspendida: 'cerrado',
};

export default function Organizaciones() {
  const [filtro, setFiltro] = useState('todas');
  const [busqueda, setBusqueda] = useState('');
  const f = FILTROS.find((x) => x.id === filtro);
  const q = busqueda.trim().toLowerCase();
  const orgs = ORGANIZACIONES.filter(
    (o) => (!f?.estado || f.estado.includes(o.estado)) && (!q || `${o.nombre} ${o.dueno} ${o.slug}`.toLowerCase().includes(q)),
  );

  return (
    <>
      <PageHeader
        title="Organizaciones"
        sub="Cada organizador es una cuenta independiente con su equipo, sus sorteos y su plan."
        actions={
          <button type="button" className="rs-btn rs-btn--primario">
            <Icon name="plus" size={18} strokeWidth={2.4} />
            Crear organización
          </button>
        }
      />

      {/* Métricas pendientes de conectar al backend: se muestran como marcadores. */}
      <section aria-label="Resumen" className="kpis">
        <div className="rs-panel kpi">
          <span className="kpi__label">Organizaciones activas</span>
          <span className="kpi__value">[N]</span>
          <span className="kpi__note">pagando un plan</span>
        </div>
        <div className="rs-panel kpi">
          <span className="kpi__label">En prueba gratis</span>
          <span className="kpi__value">[N]</span>
          <span className="kpi__note">vencen esta semana: [N]</span>
        </div>
        <div className="rs-panel kpi">
          <span className="kpi__label">Ingreso mensual (MRR)</span>
          <span className="kpi__value">[$ MRR]</span>
          <span className="kpi__note">suscripciones activas</span>
        </div>
        <div className="rs-panel kpi">
          <span className="kpi__label">Pagos de suscripción fallidos</span>
          <span className="kpi__value" style={{ color: 'var(--rojo-texto)' }}>[N]</span>
          <Link to="/plataforma/planes" className="small-link">Revisar</Link>
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
            placeholder="Buscar por nombre, dueño o correo"
            aria-label="Buscar organización"
            style={{ width: 300, maxWidth: '100%' }}
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
          />
        </div>
        <div className="table-scroll">
          <table className="rs-tabla" style={{ minWidth: 900 }}>
            <thead>
              <tr>
                <th>Organización</th><th>Propietario</th><th>Plan</th><th>Sorteos activos</th><th>Último acceso</th><th>Estado</th>
                <th style={{ textAlign: 'right' }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {orgs.map((o) => (
                <tr key={o.slug}>
                  <td>
                    <b>{o.nombre}</b><br />
                    <span className="rs-mono cell-sub" style={{ fontSize: 13 }}>{o.slug}</span>
                  </td>
                  <td>{o.dueno}</td>
                  <td><span style={{ fontWeight: 700 }}>{o.plan}</span></td>
                  <td className="rs-mono">{o.sorteos}</td>
                  <td className="cell-sub">{o.acceso}</td>
                  <td><Badge tono={TONO[o.estado]}>{o.estado}</Badge></td>
                  <td className="td-right">
                    <Link to="/admin" className="rs-btn rs-btn--secundario rs-btn--sm">Entrar como soporte</Link>
                    <button type="button" className="rs-btn rs-btn--fantasma rs-btn--sm" aria-label={`Más acciones para ${o.nombre}`} style={{ color: 'var(--tinta-suave)' }}>
                      <DotsIcon />
                    </button>
                  </td>
                </tr>
              ))}
              {orgs.length === 0 && (
                <tr>
                  <td colSpan={7} className="muted" style={{ textAlign: 'center', padding: 40 }}>Ninguna organización coincide.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <p className="info-line">
        <Icon name="info" size={16} />
        "Entrar como soporte" abre la cuenta en modo lectura, con aviso visible para el organizador, y queda en el registro de actividad.
      </p>
    </>
  );
}
