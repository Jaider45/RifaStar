import { Badge } from '@/components/Badge';
import { PageHeader } from '@/components/PageHeader';
import './plataforma.css';

const PLANES = [
  { id: 'pb', nombre: 'Básico', sorteos: '2', miembros: '1', mensajes: '300', destacado: false },
  { id: 'pp', nombre: 'Pro', sorteos: '10', miembros: '5', mensajes: '2000', destacado: true },
  { id: 'pa', nombre: 'Agencia', sorteos: '∞', miembros: '20', mensajes: '10000', destacado: false },
];

const FUNCIONES: [string, boolean, boolean, boolean][] = [
  ['Enlace público de sorteo y "Mis boletos"', true, true, true],
  ['Ranking mensual con enlace público', false, true, true],
  ['Notificaciones automáticas por WhatsApp', false, true, true],
  ['Vendedores con código y comisión', false, true, true],
  ['Roles personalizados', false, false, true],
  ['Dominio propio', false, false, true],
  ['Quitar "Creado con Rifa Star"', false, false, true],
];

export default function Planes() {
  return (
    <>
      <PageHeader
        title="Planes"
        sub="Define precios, límites y qué funciones tiene cada plan. Los cambios aplican en la próxima renovación."
        actions={<button type="button" className="rs-btn rs-btn--primario">Guardar planes</button>}
      />

      <section className="planes">
        {PLANES.map((p) => (
          <div key={p.id} className={`rs-panel plan${p.destacado ? ' plan--destacado' : ''}`}>
            <div className="fila-plan">
              <h2 className="rs-display plan__nombre">{p.nombre}</h2>
              {p.destacado ? <Badge tono="abierto">Más elegido</Badge> : <Badge tono="cerrado">[N] cuentas</Badge>}
            </div>
            <div>
              <label className="rs-label" htmlFor={p.id}>Precio mensual</label>
              <input id={p.id} className="rs-in rs-mono" placeholder="[PRECIO]" />
            </div>
            <div className="plan__limites">
              <span>Sorteos activos</span>
              <input className="rs-in rs-mono" defaultValue={p.sorteos} aria-label={`Sorteos activos ${p.nombre}`} />
              <span>Miembros del equipo</span>
              <input className="rs-in rs-mono" defaultValue={p.miembros} aria-label={`Miembros ${p.nombre}`} />
              <span>Mensajes WhatsApp / mes</span>
              <input className="rs-in rs-mono" defaultValue={p.mensajes} aria-label={`Mensajes ${p.nombre}`} />
            </div>
          </div>
        ))}
      </section>

      <section className="rs-panel overflow-hidden">
        <div className="panel-head">
          <h2 className="h2">Funciones por plan</h2>
        </div>
        <div className="table-scroll">
          <table className="rs-tabla" style={{ minWidth: 640 }}>
            <thead>
              <tr>
                <th style={{ width: '46%' }}>Función</th>
                {PLANES.map((p) => <th key={p.id} className="td-center">{p.nombre}</th>)}
              </tr>
            </thead>
            <tbody>
              {FUNCIONES.map(([nombre, ...incluye]) => (
                <tr key={nombre}>
                  <td>{nombre}</td>
                  {incluye.map((si, i) => (
                    <td key={i} className={`td-center ${si ? 'incluye--si' : 'incluye--no'}`}>{si ? 'Sí' : 'No'}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rs-panel prueba">
        <div style={{ flex: '1 1 280px' }}>
          <h2 className="h2 h2--sm">Prueba gratis</h2>
          <p className="rs-help">Plan con el que empieza una organización nueva y cuántos días dura.</p>
        </div>
        <div>
          <label className="rs-label" htmlFor="tp">Plan de prueba</label>
          <select id="tp" className="rs-in" style={{ width: 180 }}><option>Pro</option><option>Básico</option></select>
        </div>
        <div>
          <label className="rs-label" htmlFor="td">Días</label>
          <input id="td" className="rs-in rs-mono" defaultValue="14" style={{ width: 100, textAlign: 'center' }} />
        </div>
        <div>
          <label className="rs-label" htmlFor="tf">Al vencer</label>
          <select id="tf" className="rs-in" style={{ width: 240 }}><option>Pausar sorteos nuevos</option><option>Pasar a Básico</option></select>
        </div>
      </section>
    </>
  );
}
