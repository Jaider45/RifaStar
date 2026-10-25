import { Fragment, useState, type CSSProperties } from 'react';
import { Badge } from '@/components/Badge';
import { Icon } from '@/components/Icon';
import { PageHeader } from '@/components/PageHeader';
import './plataforma.css';

const ROLES = ['Propietario', 'Administrador', 'Verificador de pagos', 'Vendedor'];

const ESTRUCTURA: [string, [string, string][]][] = [
  ['Sorteos', [['s_ver', 'Ver sorteos'], ['s_crear', 'Crear y editar sorteos'], ['s_publicar', 'Publicar y cerrar ventas'], ['s_borrar', 'Eliminar sorteos']]],
  ['Pagos', [['p_ver', 'Ver pagos y comprobantes'], ['p_aprobar', 'Aprobar o rechazar pagos'], ['p_reembolsar', 'Liberar números y reembolsar']]],
  ['Participantes', [['u_ver', 'Ver nombre y WhatsApp'], ['u_exportar', 'Exportar la base de datos'], ['u_ventas', 'Ver ventas propias (código de vendedor)']]],
  ['Ranking y ganadores', [['r_config', 'Configurar el ranking'], ['g_anunciar', 'Anunciar ganadores']]],
  ['Ajustes', [['a_marca', 'Marca, pagos y notificaciones'], ['a_equipo', 'Invitar y quitar miembros'], ['a_plan', 'Plan y facturación']]],
];

/** Plantilla de permisos: [propietario, administrador, verificador, vendedor]. */
const PLANTILLA: Record<string, boolean[]> = {
  s_ver: [true, true, true, true], s_crear: [true, true, false, false], s_publicar: [true, true, false, false], s_borrar: [true, false, false, false],
  p_ver: [true, true, true, false], p_aprobar: [true, true, true, false], p_reembolsar: [true, true, false, false],
  u_ver: [true, true, true, false], u_exportar: [true, false, false, false], u_ventas: [true, true, false, true],
  r_config: [true, true, false, false], g_anunciar: [true, true, false, false],
  a_marca: [true, true, false, false], a_equipo: [true, false, false, false], a_plan: [true, false, false, false],
};

const NIVELES = [
  { id: 'org', nombre: 'Roles de organización' },
  { id: 'plat', nombre: 'Equipo de la plataforma' },
] as const;

export default function Roles() {
  const [nivel, setNivel] = useState<(typeof NIVELES)[number]['id']>('org');
  const [m, setM] = useState(PLANTILLA);
  const activos = Object.values(m).flat().filter(Boolean).length;

  const toggle = (key: string, i: number) =>
    setM((cur) => ({ ...cur, [key]: cur[key].map((v, k) => (k === i ? !v : v)) }));

  return (
    <>
      <PageHeader
        title="Roles y permisos"
        sub="Dos niveles: tu equipo que administra la plataforma, y los roles que cada organizador asigna a su equipo."
        actions={
          <button type="button" className="rs-btn rs-btn--secundario">
            <Icon name="plus" size={18} strokeWidth={2.4} />
            Crear rol personalizado
          </button>
        }
      />

      <div role="tablist" aria-label="Nivel" className="segmento-claro">
        {NIVELES.map((n) => (
          <button key={n.id} type="button" role="tab" aria-selected={nivel === n.id} onClick={() => setNivel(n.id)}>
            {n.nombre}
          </button>
        ))}
      </div>

      {nivel === 'org' && (
        <section className="rs-panel overflow-hidden" role="tabpanel">
          <div className="panel-head">
            <div>
              <h2 className="h2">Roles de una organización</h2>
              <p className="rs-help">Plantilla que reciben todas las organizaciones. Toca una casilla para cambiar el permiso.</p>
            </div>
            <Badge tono="abierto">{activos} permisos activos</Badge>
          </div>
          <div className="table-scroll">
            <table className="rs-tabla" style={{ minWidth: 760 }}>
              <thead>
                <tr>
                  <th style={{ width: '40%' }}>Permiso</th>
                  {ROLES.map((r) => <th key={r} className="td-center">{r}</th>)}
                </tr>
              </thead>
              <tbody>
                {ESTRUCTURA.map(([grupo, permisos]) => (
                  <Fragment key={grupo}>
                    <tr className="fila-grupo">
                      <td colSpan={ROLES.length + 1}><b className="eyebrow">{grupo}</b></td>
                    </tr>
                    {permisos.map(([key, nombre]) => (
                      <tr key={key}>
                        <td><span style={{ fontWeight: 600 }}>{nombre}</span></td>
                        {ROLES.map((r, i) => (
                          <td key={r} className="td-center">
                            <input
                              type="checkbox"
                              className="check"
                              checked={m[key][i]}
                              disabled={i === 0}
                              onChange={() => toggle(key, i)}
                              aria-label={`${nombre} · ${r}`}
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          <div className="panel-foot">
            El Propietario siempre tiene todos los permisos y es el único que puede borrar la cuenta. Cada organización puede crear roles propios si su plan lo incluye.
          </div>
        </section>
      )}

      {nivel === 'plat' && (
        <section className="stack" style={{ gap: 20 }} role="tabpanel">
          <div className="grid-auto" style={{ '--min': '240px' } as CSSProperties}>
            <div className="rs-panel rol-card">
              <Badge tono="ganador" style={{ alignSelf: 'flex-start' }}>Super admin</Badge>
              <span>Todo: organizaciones, planes, precios, roles, facturación y suspender cuentas.</span>
            </div>
            <div className="rs-panel rol-card">
              <Badge tono="abierto" style={{ alignSelf: 'flex-start' }}>Soporte</Badge>
              <span>Ve organizaciones y entra como soporte en modo lectura. No toca precios ni pagos.</span>
            </div>
            <div className="rs-panel rol-card">
              <Badge tono="cerrado" style={{ alignSelf: 'flex-start' }}>Finanzas</Badge>
              <span>Facturación, cobros fallidos, reembolsos y reportes. Sin acceso a sorteos.</span>
            </div>
          </div>
          <section className="rs-panel overflow-hidden">
            <div className="panel-head">
              <h2 className="h2">Equipo de la plataforma</h2>
              <button type="button" className="rs-btn rs-btn--primario rs-btn--sm">Invitar</button>
            </div>
            <div className="table-scroll">
              <table className="rs-tabla" style={{ minWidth: 640 }}>
                <thead><tr><th>Persona</th><th>Rol</th><th>Verificación en dos pasos</th><th>Último acceso</th></tr></thead>
                <tbody>
                  <tr>
                    <td><b>Jaideer</b><br /><span className="cell-sub">Tú</span></td>
                    <td><Badge tono="ganador">Super admin</Badge></td>
                    <td className="dos-pasos dos-pasos--ok">Activa</td>
                    <td>Ahora</td>
                  </tr>
                  <tr>
                    <td><b>[Nombre]</b><br /><span className="cell-sub">[correo]</span></td>
                    <td>
                      <select className="rs-in" aria-label="Rol" style={{ width: 180 }} defaultValue="Soporte">
                        <option>Soporte</option><option>Finanzas</option><option>Super admin</option>
                      </select>
                    </td>
                    <td className="dos-pasos dos-pasos--ok">Activa</td>
                    <td>Hace 1 h</td>
                  </tr>
                  <tr>
                    <td><b>[Nombre]</b><br /><span className="cell-sub">[correo]</span></td>
                    <td>
                      <select className="rs-in" aria-label="Rol" style={{ width: 180 }} defaultValue="Finanzas">
                        <option>Finanzas</option><option>Soporte</option><option>Super admin</option>
                      </select>
                    </td>
                    <td className="dos-pasos dos-pasos--pendiente">Pendiente</td>
                    <td>Ayer</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        </section>
      )}
    </>
  );
}
