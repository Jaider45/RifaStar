import { useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/Badge';
import { PageHeader } from '@/components/PageHeader';
import { ACENTOS, ORGANIZACION, PREMIOS_RANKING, SORTEO, type Acento } from '@/data/mock';
import './Ajustes.css';

const TABS = [
  { id: 'negocio', nombre: 'Negocio y marca' },
  { id: 'pagos', nombre: 'Pagos' },
  { id: 'ranking', nombre: 'Ranking' },
  { id: 'equipo', nombre: 'Equipo y roles' },
  { id: 'notif', nombre: 'Notificaciones' },
  { id: 'plan', nombre: 'Plan y facturación' },
] as const;

type TabId = (typeof TABS)[number]['id'];

function Ajuste({ t, d, children, style }: { t: string; d: string; children?: ReactNode; style?: CSSProperties }) {
  return (
    <div className="setting" style={style}>
      <div>
        <div className="setting__t">{t}</div>
        <div className="setting__d">{d}</div>
      </div>
      {children}
    </div>
  );
}

function Switch({ label, defaultChecked = true }: { label: string; defaultChecked?: boolean }) {
  return <input type="checkbox" className="switch" role="switch" defaultChecked={defaultChecked} aria-label={label} />;
}

const EQUIPO = [
  { nombre: 'José Rodríguez', correo: 'jose@correo.com', rol: 'Administrador', acceso: 'Hace 2 h', accion: 'Quitar' },
  { nombre: 'Karen Díaz', correo: 'karen@correo.com', rol: 'Verificador de pagos', acceso: 'Hace 20 min', accion: 'Quitar' },
  { nombre: 'Luis Mora', correo: 'Invitación pendiente', rol: 'Vendedor', acceso: '—', accion: 'Reenviar' },
];
const ROLES = ['Administrador', 'Verificador de pagos', 'Vendedor'];

export default function Ajustes() {
  const [tab, setTab] = useState<TabId>('ranking');
  const [color, setColor] = useState<Acento['id']>('verde');

  return (
    <>
      <PageHeader title="Ajustes" sub="Lo que configures aquí se aplica a todos tus sorteos y enlaces públicos." />

      <div className="split split--24">
        <div role="tablist" aria-orientation="vertical" aria-label="Secciones de ajustes" className="ajustes-tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              id={`tab-${t.id}`}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              aria-controls={`panel-${t.id}`}
              className="ajustes-tab"
              onClick={() => setTab(t.id)}
            >
              {t.nombre}
            </button>
          ))}
        </div>

        <div className="split__main" role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
          {tab === 'negocio' && (
            <section className="rs-panel panel-pad">
              <h2 className="h2 h2--lg">Negocio y marca</h2>
              <div className="grid-auto" style={{ '--min': '240px' } as CSSProperties}>
                <div>
                  <label className="rs-label" htmlFor="nnombre">Nombre público</label>
                  <input id="nnombre" className="rs-in" defaultValue={ORGANIZACION.nombre} />
                </div>
                <div>
                  <label className="rs-label" htmlFor="nwa">WhatsApp de soporte</label>
                  <input id="nwa" className="rs-in rs-mono" defaultValue="+57 316 811 0777" />
                </div>
              </div>
              <div>
                <label className="rs-label" htmlFor="nslug">Tu dirección</label>
                <div className="prefixed">
                  <span className="prefixed__pre">rifastar.co/</span>
                  <input id="nslug" className="prefixed__in" defaultValue={ORGANIZACION.slug} />
                </div>
                <p className="rs-help">Plan Agencia: usa tu propio dominio (rifas.tunegocio.com).</p>
              </div>
              <div className="logo-org">
                <div className="rs-foto logo-org__foto">Logo</div>
                <div>
                  <div className="setting__t">Logo del organizador</div>
                  <div className="setting__d">Aparece junto al de Rifa Star en tus enlaces. PNG cuadrado.</div>
                </div>
                <label className="rs-btn rs-btn--secundario rs-btn--sm" style={{ marginLeft: 'auto' }}>
                  Subir logo
                  <input type="file" accept="image/png" className="sr-only" />
                </label>
              </div>
              <fieldset className="bare-fieldset">
                <legend className="rs-label">Color por defecto de los sorteos</legend>
                <div className="chips">
                  {ACENTOS.slice(0, 3).map((a) => (
                    <button key={a.id} type="button" className="rs-chip" aria-pressed={color === a.id} onClick={() => setColor(a.id)}>
                      <span aria-hidden="true" style={{ width: 16, height: 16, borderRadius: '50%', background: a.color }} />
                      {a.nombre}
                    </button>
                  ))}
                </div>
              </fieldset>
            </section>
          )}

          {tab === 'pagos' && (
            <section className="rs-panel setting-panel">
              <h2 className="h2 h2--lg setting-panel__title">Pagos</h2>
              <Ajuste t="Cuentas para recibir pagos" d={`Llave Bre-B ${SORTEO.pago.llave} · ${SORTEO.pago.titular}. Nequi ${SORTEO.pago.nequi}.`}>
                <button type="button" className="rs-btn rs-btn--secundario rs-btn--sm">Editar cuentas</button>
              </Ajuste>
              <Ajuste t="Tiempo de apartado" d="Cuánto tiempo queda reservado un número mientras el participante paga.">
                <select className="rs-in" aria-label="Tiempo de apartado" style={{ width: 160 }}>
                  <option>30 minutos</option><option>1 hora</option><option>2 horas</option>
                </select>
              </Ajuste>
              <Ajuste t="Exigir comprobante" d="El participante debe subir la captura para enviar su pago a verificación.">
                <Switch label="Exigir comprobante" />
              </Ajuste>
              <Ajuste t="Quién puede aprobar pagos" d="Propietaria, Administradores y Verificadores de pago.">
                <button type="button" className="rs-btn rs-btn--fantasma rs-btn--sm" onClick={() => setTab('equipo')}>Ver roles</button>
              </Ajuste>
            </section>
          )}

          {tab === 'ranking' && (
            <section className="rs-panel setting-panel">
              <div className="setting-panel__title ajustes-head">
                <h2 className="h2 h2--lg">Ranking</h2>
                <Link to={`/r/${ORGANIZACION.slug}`} className="rs-btn rs-btn--secundario rs-btn--sm">Ver enlace público</Link>
              </div>
              <Ajuste t="Activar ranking" d="Lista pública de quienes más participan. Motiva a comprar más números cada mes.">
                <Switch label="Activar ranking" />
              </Ajuste>
              <Ajuste t="Reinicio" d="El ranking vuelve a cero y el mes anterior queda en el historial.">
                <div className="ajustes-selects">
                  <select className="rs-in" aria-label="Frecuencia" style={{ width: 150 }}>
                    <option>Mensual</option><option>Quincenal</option><option>Semanal</option>
                  </select>
                  <select className="rs-in" aria-label="Día de reinicio" style={{ width: 150 }}>
                    <option>Día 1, 12:00 a. m.</option><option>Último sábado</option>
                  </select>
                </div>
              </Ajuste>
              <Ajuste t="Cómo se suman puntos" d="Solo cuentan números pagos y verificados.">
                <div className="puntos-grid">
                  <span>Puntos por número pagado</span>
                  <input className="rs-in rs-mono" defaultValue="1" aria-label="Puntos por número" />
                  <span>Bono por jugar 4+ sorteos</span>
                  <input className="rs-in rs-mono" defaultValue="5" aria-label="Bono por constancia" />
                  <span>Bono por referir a alguien</span>
                  <input className="rs-in rs-mono" defaultValue="2" aria-label="Bono por referido" />
                </div>
              </Ajuste>
              <Ajuste t="Desempate" d="Si dos personas tienen los mismos puntos.">
                <select className="rs-in" aria-label="Desempate" style={{ width: 240 }}>
                  <option>Gana quien llegó primero</option><option>Gana quien jugó más sorteos</option>
                </select>
              </Ajuste>
              <Ajuste t="Qué se muestra en público" d="Nunca se muestra el número de WhatsApp completo.">
                <div className="ajustes-selects ajustes-selects--col">
                  <select className="rs-in" aria-label="Formato del nombre" style={{ width: 240 }}>
                    <option>Nombre e inicial (Laura M.)</option><option>Solo iniciales (L. M.)</option><option>Apodo que elija</option>
                  </select>
                  <select className="rs-in" aria-label="Cantidad visible" style={{ width: 240 }}>
                    <option>Top 20</option><option>Top 10</option><option>Top 50</option>
                  </select>
                </div>
              </Ajuste>
              <Ajuste t="Premios del ranking" d="Se entregan al cerrar el periodo. Déjalos vacíos si no das premio." style={{ flexWrap: 'wrap' }}>
                <div className="premios-ranking">
                  {PREMIOS_RANKING.map((p, i) => (
                    <PremioPuesto key={p} puesto={i + 1} valor={p} />
                  ))}
                </div>
              </Ajuste>
              <Ajuste t="Anunciar al cerrar" d="Envía el top 10 por WhatsApp a tus participantes el día del reinicio.">
                <Switch label="Anunciar al cerrar" />
              </Ajuste>
            </section>
          )}

          {tab === 'equipo' && (
            <section className="rs-panel overflow-hidden">
              <div className="ajustes-head ajustes-head--equipo">
                <div>
                  <h2 className="h2 h2--lg">Equipo y roles</h2>
                  <p className="rs-help">4 de 5 miembros en tu plan.</p>
                </div>
                <button type="button" className="rs-btn rs-btn--primario rs-btn--sm">Invitar miembro</button>
              </div>
              <div className="table-scroll">
                <table className="rs-tabla" style={{ minWidth: 600 }}>
                  <thead><tr><th>Miembro</th><th>Rol</th><th>Último acceso</th><th></th></tr></thead>
                  <tbody>
                    <tr>
                      <td><b>{ORGANIZACION.propietaria}</b><br /><span className="cell-sub">michellys@correo.com</span></td>
                      <td><Badge tono="ganador">Propietaria</Badge></td>
                      <td>Ahora</td>
                      <td></td>
                    </tr>
                    {EQUIPO.map((m) => (
                      <tr key={m.nombre}>
                        <td><b>{m.nombre}</b><br /><span className="cell-sub">{m.correo}</span></td>
                        <td>
                          <select className="rs-in" aria-label={`Rol de ${m.nombre.split(' ')[0]}`} style={{ width: 200 }} defaultValue={m.rol}>
                            {ROLES.map((r) => <option key={r}>{r}</option>)}
                          </select>
                        </td>
                        <td>{m.acceso}</td>
                        <td>
                          <button
                            type="button"
                            className="rs-btn rs-btn--fantasma rs-btn--sm"
                            style={m.accion === 'Quitar' ? { color: 'var(--rojo-texto)' } : undefined}
                          >
                            {m.accion}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="roles-resumen">
                <div><div className="setting__t">Administrador</div><div className="setting__d">Todo, menos facturación y borrar la cuenta.</div></div>
                <div><div className="setting__t">Verificador de pagos</div><div className="setting__d">Solo ve y aprueba pagos de los sorteos.</div></div>
                <div><div className="setting__t">Vendedor</div><div className="setting__d">Comparte enlaces con su código y ve sus ventas.</div></div>
              </div>
            </section>
          )}

          {tab === 'notif' && (
            <section className="rs-panel setting-panel">
              <h2 className="h2 h2--lg setting-panel__title">Notificaciones por WhatsApp</h2>
              <Ajuste t="Confirmación de compra" d="Al aprobar el pago, el participante recibe su boleto."><Switch label="Confirmación de compra" /></Ajuste>
              <Ajuste t="Recordatorio antes del sorteo" d="2 horas antes, a quienes tienen números."><Switch label="Recordatorio" /></Ajuste>
              <Ajuste t="Aviso de nuevo sorteo" d={'A quienes pidieron "Avísame".'}><Switch label="Aviso de nuevo sorteo" /></Ajuste>
              <Ajuste t="Resumen diario para mí" d="Ventas y pagos pendientes a las 8:00 p. m."><Switch label="Resumen diario" defaultChecked={false} /></Ajuste>
            </section>
          )}

          {tab === 'plan' && (
            <section className="rs-panel panel-pad" style={{ gap: 20 }}>
              <div className="ajustes-head">
                <div>
                  <h2 className="h2 h2--lg">Plan Pro</h2>
                  <p className="rs-help">[PRECIO] / mes · renueva el 3 de noviembre</p>
                </div>
                <button type="button" className="rs-btn rs-btn--secundario rs-btn--sm">Cambiar plan</button>
              </div>
              <div className="grid-auto">
                <Uso t="Sorteos activos" pct={20} d="2 de 10" />
                <Uso t="Miembros del equipo" pct={80} d="4 de 5" />
                <Uso t="Mensajes de WhatsApp" pct={46} d="920 de 2.000 este mes" />
              </div>
              <Ajuste t="Método de pago" d="Tarjeta terminada en 4821" style={{ borderTop: '1px solid var(--linea)' }}>
                <button type="button" className="rs-btn rs-btn--fantasma rs-btn--sm">Actualizar</button>
              </Ajuste>
            </section>
          )}

          <div className="ajustes-acciones">
            <button type="button" className="rs-btn rs-btn--secundario">Descartar</button>
            <button type="button" className="rs-btn rs-btn--primario">Guardar cambios</button>
          </div>
        </div>
      </div>
    </>
  );
}

function PremioPuesto({ puesto, valor }: { puesto: number; valor: string }) {
  const nombres = ['primer', 'segundo', 'tercer'];
  return (
    <>
      <span className="rs-mono premios-ranking__pos">{puesto}°</span>
      <input className="rs-in" defaultValue={valor} aria-label={`Premio ${nombres[puesto - 1]} puesto`} />
    </>
  );
}

function Uso({ t, pct, d }: { t: string; pct: number; d: string }) {
  return (
    <div>
      <div className="setting__t">{t}</div>
      <div className="rs-progreso" style={{ margin: '8px 0 6px' }}><span style={{ width: `${pct}%` }} /></div>
      <div className="setting__d">{d}</div>
    </div>
  );
}
