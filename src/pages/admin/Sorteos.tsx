import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, type BadgeTono } from '@/components/Badge';
import { Icon } from '@/components/Icon';
import { PageHeader } from '@/components/PageHeader';
import { JUEGA_EN, MIS_SORTEOS, ORGANIZACION, SORTEO, type FilaSorteo } from '@/data/mock';
import { usePagos } from '@/data/PagosContext';
import { cop, pad } from '@/lib/format';
import { useCountdown } from '@/lib/useCountdown';
import './Sorteos.css';

const FILTROS = [
  { id: 'todos', label: 'Todos' },
  { id: 'activos', label: 'Activos' },
  { id: 'finalizados', label: 'Finalizados' },
  { id: 'borradores', label: 'Borradores' },
] as const;

const TONO: Record<FilaSorteo['estado'], BadgeTono> = {
  Abierto: 'abierto',
  'Ganador entregado': 'ganador',
  Finalizado: 'cerrado',
  Borrador: 'cerrado',
};

export default function Sorteos() {
  const { pendientes } = usePagos();
  const [filtro, setFiltro] = useState<(typeof FILTROS)[number]['id']>('todos');
  const r = useCountdown(JUEGA_EN);
  const filas = MIS_SORTEOS.filter((f) => filtro === 'todos' || f.grupo === filtro);
  const primerNombre = ORGANIZACION.propietaria.split(' ')[0];

  return (
    <div className="stack" style={{ gap: 28 }}>
      <PageHeader
        title={`Hola, ${primerNombre}`}
        sub={`Tienes ${pendientes.length} pagos por verificar y un sorteo que juega hoy.`}
        actions={
          <>
            <Link to="/admin/pagos" className="rs-btn rs-btn--secundario">Verificar pagos</Link>
            <Link to="/admin/sorteos/nuevo" className="rs-btn rs-btn--primario">
              <Icon name="plus" size={18} strokeWidth={2.4} />
              Nuevo sorteo
            </Link>
          </>
        }
      />

      <section aria-label="Resumen" className="kpis">
        <div className="rs-panel kpi">
          <span className="kpi__label">Recaudado esta semana</span>
          <span className="kpi__value">{cop(372000)}</span>
          <span className="kpi__note kpi__note--ok">62 números pagos</span>
        </div>
        <div className="rs-panel kpi">
          <span className="kpi__label">Pagos por verificar</span>
          <span className="kpi__value">{pendientes.length}</span>
          <Link to="/admin/pagos" className="small-link">Revisar ahora</Link>
        </div>
        <div className="rs-panel kpi">
          <span className="kpi__label">Sorteos activos</span>
          <span className="kpi__value">2</span>
          <span className="kpi__note">1 borrador</span>
        </div>
        <div className="rs-panel kpi kpi--hoy">
          <span className="kpi__label">Juega hoy · 10:40 p. m.</span>
          <span className="kpi--hoy__nombre">{SORTEO.nombreCorto}</span>
          <span className="kpi--hoy__reloj" aria-label="Tiempo restante">
            {pad(r.dias * 24 + r.horas)}:{pad(r.minutos)}:{pad(r.segundos)}
          </span>
        </div>
      </section>

      <section className="rs-panel overflow-hidden">
        <div className="panel-head">
          <h2 className="h2">Mis sorteos</h2>
          <div className="chips">
            {FILTROS.map((f) => (
              <button key={f.id} type="button" className="rs-chip" aria-pressed={filtro === f.id} onClick={() => setFiltro(f.id)}>
                {f.label}
              </button>
            ))}
          </div>
        </div>
        <div className="table-scroll">
          <table className="rs-tabla" style={{ minWidth: 860 }}>
            <thead>
              <tr>
                <th>Sorteo</th>
                <th>Juega</th>
                <th style={{ width: 200 }}>Vendidos</th>
                <th>Recaudo</th>
                <th>Estado</th>
                <th style={{ textAlign: 'right' }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => {
                const pct = Math.round((f.vendidos / f.total) * 100);
                return (
                  <tr key={f.slug + f.nombre}>
                    <td>
                      <div className="sorteo-cell">
                        <span className="rs-foto sorteo-cell__foto" aria-hidden="true" />
                        <div>
                          <div className="sorteo-cell__nombre">{f.nombre}</div>
                          <div className="rs-mono sorteo-cell__slug">{f.slug}</div>
                        </div>
                      </div>
                    </td>
                    <td>{f.fecha}</td>
                    <td>
                      <div className="rs-progreso" style={{ height: 8 }}>
                        <span style={{ width: `${pct}%` }} />
                      </div>
                      <div className="sorteo-cell__vendidos">
                        {f.vendidos} de {f.total} · {pct}%
                      </div>
                    </td>
                    <td className="td-mono">{cop(f.recaudo)}</td>
                    <td>
                      <Badge tono={TONO[f.estado]}>{f.estado}</Badge>
                    </td>
                    <td className="td-right">
                      <button type="button" className="rs-btn rs-btn--secundario rs-btn--sm" aria-label={`Copiar enlace de ${f.nombre}`}>
                        <Icon name="link" size={16} />
                        Enlace
                      </button>
                      <Link to={f.destino} className="rs-btn rs-btn--fantasma rs-btn--sm">{f.accion}</Link>
                    </td>
                  </tr>
                );
              })}
              {filas.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted" style={{ textAlign: 'center', padding: 40 }}>
                    No hay sorteos en esta lista.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
