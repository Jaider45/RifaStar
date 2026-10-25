import { useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '@/components/Icon';
import { Logo } from '@/components/Logo';
import { PageHeader } from '@/components/PageHeader';
import { ACENTOS, LOTERIAS, SORTEO, type Acento } from '@/data/mock';
import { cop, fechaSorteo, pad, soloDigitos } from '@/lib/format';
import './Constructor.css';

const PASOS = [
  { id: 'info', nombre: 'Información' },
  { id: 'numeros', nombre: 'Precio y números' },
  { id: 'premios', nombre: 'Premios' },
  { id: 'pago', nombre: 'Pagos' },
  { id: 'diseno', nombre: 'Diseño' },
];

const METODOS = ['Llave Bre-B', 'Nequi', 'Daviplata', 'Transferencia'];

/** Muestra de 15 números en la vista previa: algunos vendidos y dos seleccionados. */
const MUESTRA_VENDIDOS = [1, 4, 7, 8, 12];
const MUESTRA_SELECCION = [3, 10];

let siguienteId = 0;
const conId = (p: { monto: number; regla: string }) => ({ id: ++siguienteId, monto: cop(p.monto), regla: p.regla });

export default function Constructor() {
  const [paso, setPaso] = useState('info');
  const [titulo, setTitulo] = useState(SORTEO.titulo);
  const [loteria, setLoteria] = useState(SORTEO.loteria);
  const [fecha, setFecha] = useState(SORTEO.fecha);
  const [hora, setHora] = useState(SORTEO.hora);
  const [precio, setPrecio] = useState(String(SORTEO.precio));
  const [minimo, setMinimo] = useState('1');
  const [cifras, setCifras] = useState(SORTEO.cifras);
  const [premios, setPremios] = useState(() => SORTEO.premios.map(conId));
  const [condicion, setCondicion] = useState(SORTEO.condicion);
  const [metodos, setMetodos] = useState<string[]>(['Llave Bre-B', 'Nequi']);
  const [llave, setLlave] = useState(SORTEO.pago.llave);
  const [titular, setTitular] = useState(SORTEO.pago.titular);
  const [comprobante, setComprobante] = useState(true);
  const [acento, setAcento] = useState<Acento['id']>(SORTEO.acento);
  const [enlace, setEnlace] = useState(SORTEO.slug);

  const precioNum = soloDigitos(precio);
  const total = 10 ** cifras;
  const actual = ACENTOS.find((a) => a.id === acento) ?? ACENTOS[0];
  const previewStyle = { '--acento': actual.color, '--on-acento': actual.on } as CSSProperties;

  const toggleMetodo = (m: string) =>
    setMetodos((cur) => (cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m]));

  const editarPremio = (id: number, campo: 'monto' | 'regla', valor: string) =>
    setPremios((cur) => cur.map((p) => (p.id === id ? { ...p, [campo]: valor } : p)));

  return (
    <div className="stack constructor" style={{ gap: 24 }}>
      <PageHeader
        crumb={{ to: '/admin', label: 'Mis sorteos /' }}
        title="Nuevo sorteo"
        sub="Completa los datos y comparte el enlace. La vista previa se actualiza mientras escribes."
        actions={
          <>
            <button type="button" className="rs-btn rs-btn--secundario">Guardar borrador</button>
            <button type="button" className="rs-btn rs-btn--primario">
              <Icon name="link" size={18} strokeWidth={2.2} />
              Publicar y copiar enlace
            </button>
          </>
        }
      />

      <ol aria-label="Pasos" className="pasos">
        {PASOS.map((p, i) => (
          <li key={p.id}>
            <a href={`#${p.id}`} className="paso" aria-current={paso === p.id ? 'step' : undefined} onClick={() => setPaso(p.id)}>
              <span className="paso__n">{i + 1}</span>
              {p.nombre}
            </a>
          </li>
        ))}
      </ol>

      <div className="split split--24">
        <div className="split__main">
          {/* 1. Información */}
          <section id="info" className="rs-panel panel-pad">
            <div>
              <h2 className="h2">1. Información del sorteo</h2>
              <p className="rs-help">Lo primero que ve el participante al abrir el enlace.</p>
            </div>
            <div>
              <label className="rs-label" htmlFor="titulo">Título</label>
              <input id="titulo" className="rs-in" value={titulo} onChange={(e) => setTitulo(e.target.value)} maxLength={60} />
              <p className="rs-help">{titulo.length} / 60 · Sin emojis: el diseño ya pone la emoción.</p>
            </div>
            <div className="grid-auto" style={{ '--min': '180px' } as CSSProperties}>
              <div>
                <label className="rs-label" htmlFor="loteria">Juega con</label>
                <select id="loteria" className="rs-in" value={loteria} onChange={(e) => setLoteria(e.target.value)}>
                  {LOTERIAS.map((l) => <option key={l}>{l}</option>)}
                </select>
              </div>
              <div>
                <label className="rs-label" htmlFor="fecha">Fecha del sorteo</label>
                <input id="fecha" className="rs-in" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
              </div>
              <div>
                <label className="rs-label" htmlFor="hora">Hora</label>
                <input id="hora" className="rs-in" type="time" value={hora} onChange={(e) => setHora(e.target.value)} />
              </div>
            </div>
            <div>
              <span className="rs-label">Foto de portada</span>
              <div className="rs-foto dropzone">
                <Icon name="upload" size={28} />
                <span>Arrastra la foto del premio o del sorteo<br />JPG o PNG · horizontal 16:9</span>
                <label className="rs-btn rs-btn--secundario rs-btn--sm" style={{ marginTop: 4 }}>
                  Elegir archivo
                  <input type="file" accept="image/jpeg,image/png" className="sr-only" />
                </label>
              </div>
            </div>
          </section>

          {/* 2. Precio y números */}
          <section id="numeros" className="rs-panel panel-pad">
            <div>
              <h2 className="h2">2. Precio y números</h2>
              <p className="rs-help">Define cuántos números se venden y cuánto cuesta cada uno.</p>
            </div>
            <div className="grid-auto">
              <div>
                <label className="rs-label" htmlFor="precio">Precio por número (COP)</label>
                <input id="precio" className="rs-in rs-mono" inputMode="numeric" value={precio} onChange={(e) => setPrecio(e.target.value)} />
              </div>
              <div>
                <label className="rs-label" htmlFor="minimo">Mínimo por compra</label>
                <input id="minimo" className="rs-in rs-mono" inputMode="numeric" value={minimo} onChange={(e) => setMinimo(e.target.value)} />
              </div>
            </div>
            <fieldset className="bare-fieldset">
              <legend className="rs-label">Cantidad de números</legend>
              <div className="chips">
                {[2, 3, 4].map((c) => (
                  <button key={c} type="button" className="rs-chip" aria-pressed={cifras === c} onClick={() => setCifras(c)}>
                    {c} cifras
                    <span style={{ opacity: 0.7, fontWeight: 500 }}>{'0'.repeat(c)}–{'9'.repeat(c)}</span>
                  </button>
                ))}
              </div>
            </fieldset>
            <div className="note note--ok" style={{ padding: '14px 16px' }}>
              <Icon name="trend" strokeWidth={2.2} />
              <span>
                Recaudo total si se venden todos: <b className="rs-mono">{cop(precioNum * total)} · {total.toLocaleString('es-CO')} números</b>
              </span>
            </div>
          </section>

          {/* 3. Premios */}
          <section id="premios" className="rs-panel panel-pad" style={{ gap: 16 }}>
            <div className="seccion-top">
              <div>
                <h2 className="h2">3. Premios</h2>
                <p className="rs-help">Cada premio con su monto y cómo se gana. Se muestran en este orden.</p>
              </div>
              <button
                type="button"
                className="rs-btn rs-btn--secundario rs-btn--sm"
                onClick={() => setPremios((cur) => [...cur, conId({ monto: 0, regla: '' })])}
              >
                <Icon name="plus" size={16} strokeWidth={2.4} />
                Agregar premio
              </button>
            </div>
            {premios.map((p) => (
              <div key={p.id} className="premio-fila">
                <span aria-hidden="true" className="premio-fila__asa">⋮⋮</span>
                <input className="rs-in rs-mono" value={p.monto} onChange={(e) => editarPremio(p.id, 'monto', e.target.value)} aria-label="Monto del premio" />
                <input className="rs-in" value={p.regla} onChange={(e) => editarPremio(p.id, 'regla', e.target.value)} aria-label="Cómo se gana" />
                <button
                  type="button"
                  className="rs-btn rs-btn--fantasma rs-btn--sm"
                  aria-label="Eliminar premio"
                  style={{ color: 'var(--tinta-suave)' }}
                  onClick={() => setPremios((cur) => cur.filter((x) => x.id !== p.id))}
                >
                  <Icon name="trash" size={18} />
                </button>
              </div>
            ))}
            <div>
              <label className="rs-label" htmlFor="condicion">Condición de participación</label>
              <input id="condicion" className="rs-in" value={condicion} onChange={(e) => setCondicion(e.target.value)} />
            </div>
          </section>

          {/* 4. Cómo te pagan */}
          <section id="pago" className="rs-panel panel-pad">
            <div>
              <h2 className="h2">4. Cómo te pagan</h2>
              <p className="rs-help">El participante verá estos datos con un botón para copiarlos.</p>
            </div>
            <div className="chips">
              {METODOS.map((m) => (
                <button key={m} type="button" className="rs-chip" aria-pressed={metodos.includes(m)} onClick={() => toggleMetodo(m)}>
                  {m}
                </button>
              ))}
            </div>
            <div className="grid-auto">
              <div>
                <label className="rs-label" htmlFor="llave">Llave / número</label>
                <input id="llave" className="rs-in rs-mono" value={llave} onChange={(e) => setLlave(e.target.value)} />
              </div>
              <div>
                <label className="rs-label" htmlFor="titular">Titular</label>
                <input id="titular" className="rs-in" value={titular} onChange={(e) => setTitular(e.target.value)} />
              </div>
            </div>
            <label className="check-row">
              <input type="checkbox" checked={comprobante} onChange={(e) => setComprobante(e.target.checked)} />
              <span>
                <span className="check-row__t">Pedir comprobante de pago</span>
                <span className="rs-help" style={{ display: 'block', marginTop: 0 }}>
                  El número queda apartado 30 minutos hasta que subas o verifiques el comprobante.
                </span>
              </span>
            </label>
          </section>

          {/* 5. Diseño */}
          <section id="diseno" className="rs-panel panel-pad">
            <div>
              <h2 className="h2">5. Diseño del enlace</h2>
              <p className="rs-help">Personaliza el color del sorteo. El logo y la letra de Rifa Star se mantienen.</p>
            </div>
            <fieldset className="bare-fieldset">
              <legend className="rs-label">Color del sorteo</legend>
              <div className="chips">
                {ACENTOS.map((a) => (
                  <button key={a.id} type="button" className="rs-chip" aria-pressed={acento === a.id} onClick={() => setAcento(a.id)}>
                    <span aria-hidden="true" className="punto-color" style={{ background: a.color }} />
                    {a.nombre}
                  </button>
                ))}
              </div>
            </fieldset>
            <div>
              <label className="rs-label" htmlFor="enlace">Enlace del sorteo</label>
              <div className="prefixed">
                <span className="prefixed__pre">rifastar.co/</span>
                <input id="enlace" className="prefixed__in" value={enlace} onChange={(e) => setEnlace(e.target.value)} />
              </div>
            </div>
          </section>
        </div>

        {/* Vista previa */}
        <aside aria-label="Vista previa del enlace" className="split__aside preview">
          <div className="preview__top">
            <span className="eyebrow">Vista previa</span>
            <Link to={`/s/${SORTEO.slug}`} className="strong-link">Abrir en móvil</Link>
          </div>
          <div className="rs-oscuro preview__phone" style={previewStyle}>
            <div className="preview__screen">
              <div className="preview__bar">
                <Logo variante="blanco" height={22} />
                <span className="rs-badge rs-badge--abierto">Abierto</span>
              </div>
              <div className="rs-foto preview__foto">Foto de portada</div>
              <div className="preview__body">
                <h3 className="rs-display preview__titulo">{titulo || 'Título del sorteo'}</h3>
                <p className="preview__meta">{loteria} · {fechaSorteo(fecha, hora)}</p>
                <div className="preview__precio">
                  <span>Cada número</span>
                  <span className="rs-display">{cop(precioNum)}</span>
                </div>
                <div className="rs-progreso"><span style={{ width: '62%' }} /></div>
                <div className="preview__nums">
                  {Array.from({ length: 15 }, (_, i) => (
                    <span
                      key={i}
                      className={`rs-num preview__num${MUESTRA_VENDIDOS.includes(i) ? ' preview__num--vendido' : ''}`}
                      aria-pressed={MUESTRA_SELECCION.includes(i)}
                    >
                      {pad(i, cifras)}
                    </span>
                  ))}
                </div>
                <span className="rs-btn rs-btn--primario preview__cta">Elegir mis números</span>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
