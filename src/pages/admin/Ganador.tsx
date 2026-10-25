import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/Badge';
import { Icon } from '@/components/Icon';
import { Logo } from '@/components/Logo';
import { PageHeader } from '@/components/PageHeader';
import { DUENOS, SORTEO } from '@/data/mock';
import { cop } from '@/lib/format';
import './Ganador.css';

const NOMBRES_DIGITO = ['Primer', 'Segundo', 'Tercer', 'Cuarto'];

/** "Laura Martínez" → "Laura M." (así se anuncia en público). */
function nombreCorto(nombre: string) {
  const [n, a] = nombre.split(' ');
  return a ? `${n} ${a[0]}.` : n;
}

export default function Ganador() {
  const [digitos, setDigitos] = useState(['4', '0', '5', '8']);
  const [anticipado, setAnticipado] = useState('1273');
  const [entregados, setEntregados] = useState<number[]>([2, 4]);
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  const [d1, d2, d3, d4] = digitos;
  const completo = digitos.every((d) => d !== '');
  const resultado = digitos.join('');

  // Cómo se calcula el número ganador de cada premio, en el orden del sorteo.
  const numeros = [d3 + d4, d1 + d2, d2 + d3, d1 + d4, anticipado.slice(-2)];
  const ganadores = SORTEO.premios.map((p, i) => {
    const numero = completo || i === 4 ? numeros[i] : '';
    const dueno = numero.length === 2 ? DUENOS[numero] : undefined;
    return { premio: p, numero, dueno };
  });
  const vendidos = ganadores.filter((g) => g.dueno).length;
  const mayor = ganadores[0];

  const cambiarDigito = (i: number, valor: string) => {
    const d = valor.replace(/\D/g, '').slice(-1);
    setDigitos((cur) => cur.map((x, k) => (k === i ? d : x)));
    if (d && i < 3) refs.current[i + 1]?.focus();
  };

  return (
    <>
      <PageHeader
        crumb={{ to: '/admin', label: `${SORTEO.nombreCorto} · 24 oct /` }}
        title="Anunciar ganadores"
        sub="Escribe el resultado de la lotería. Rifa Star calcula los ganadores de cada premio con los números pagos."
      />

      <div className="split">
        <div className="split__main">
          <section className="rs-panel resultado">
            <fieldset className="bare-fieldset">
              <legend className="rs-label">Resultado {SORTEO.loteria}</legend>
              <div className="resultado__digitos">
                {digitos.map((d, i) => (
                  <input
                    key={i}
                    ref={(el) => { refs.current[i] = el; }}
                    className="rs-in rs-mono resultado__digito"
                    value={d}
                    inputMode="numeric"
                    aria-label={`${NOMBRES_DIGITO[i]} dígito`}
                    onChange={(e) => cambiarDigito(i, e.target.value)}
                    onFocus={(e) => e.target.select()}
                  />
                ))}
              </div>
            </fieldset>
            <div>
              <label className="rs-label" htmlFor="antio">Anticipado · Antioqueñita 4:00 p. m.</label>
              <input
                id="antio"
                className="rs-in rs-mono resultado__anticipado"
                value={anticipado}
                inputMode="numeric"
                maxLength={4}
                onChange={(e) => setAnticipado(e.target.value.replace(/\D/g, ''))}
              />
            </div>
            <div className="resultado__prueba">
              <span className="rs-label" style={{ margin: 0 }}>Prueba</span>
              <label className="rs-btn rs-btn--secundario">
                <Icon name="upload" size={18} />
                Subir foto o video del resultado
                <input type="file" accept="image/*,video/*" className="sr-only" />
              </label>
            </div>
          </section>

          <section className="rs-panel overflow-hidden">
            <div className="panel-head">
              <h2 className="h2">Ganadores calculados</h2>
              <Badge tono={vendidos === ganadores.length ? 'abierto' : 'cerrado'}>
                {vendidos} de {ganadores.length} vendidos
              </Badge>
            </div>
            <div className="table-scroll">
              <table className="rs-tabla" style={{ minWidth: 640 }}>
                <thead>
                  <tr><th>Premio</th><th>Número</th><th>Ganador</th><th>Monto</th><th>Entrega</th></tr>
                </thead>
                <tbody>
                  {ganadores.map((g, i) => (
                    <tr key={g.premio.regla}>
                      <td>{g.premio.etiqueta ?? g.premio.regla}</td>
                      <td>
                        <span className={`num-tag${i === 0 ? ' num-tag--oro' : ''}`}>{g.numero || '––'}</span>
                      </td>
                      <td>
                        {g.dueno ? (
                          <>
                            <b>{g.dueno.nombre}</b><br />
                            <span className="cell-sub">{g.dueno.wa}</span>
                          </>
                        ) : (
                          <>
                            <b>Sin ganador</b><br />
                            <span className="cell-sub">{g.numero ? 'Número no vendido' : 'Falta el resultado'}</span>
                          </>
                        )}
                      </td>
                      <td className="td-mono">{cop(g.premio.monto)}</td>
                      <td>
                        {!g.dueno ? (
                          <span className="cell-sub">—</span>
                        ) : entregados.includes(i) ? (
                          <Badge tono="abierto">Entregado</Badge>
                        ) : (
                          <button type="button" className="rs-btn rs-btn--secundario rs-btn--sm" onClick={() => setEntregados((cur) => [...cur, i])}>
                            Marcar entregado
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <aside aria-label="Pieza para estados de WhatsApp" className="split__aside" style={{ flexBasis: 320 }}>
          <span className="eyebrow">Pieza para estados y grupos</span>
          <div className="rs-oscuro pieza">
            <span aria-hidden="true" className="pieza__dado pieza__dado--rojo" />
            <span aria-hidden="true" className="pieza__dado pieza__dado--verde" />
            <Logo variante="blanco" className="pieza__logo" />
            <div className="pieza__body">
              <span className="rs-badge rs-badge--ganador" style={{ alignSelf: 'flex-start' }}>★ Ganadora</span>
              <span className="rs-display pieza__titulo">
                ¡Felicidades, {mayor.dueno ? nombreCorto(mayor.dueno.nombre) : '[Nombre]'}!
              </span>
              <div className="pieza__premio">
                <span className="rs-mono pieza__numero">{mayor.numero || '––'}</span>
                <span className="pieza__regla">
                  {mayor.premio.regla}<br />
                  <b className="rs-display">{cop(mayor.premio.monto)}</b>
                </span>
              </div>
              <span className="pieza__pie">
                {SORTEO.loteria} · 24 oct · Resultado {completo ? resultado : '––––'}
              </span>
            </div>
          </div>
          <button type="button" className="rs-btn rs-btn--primario">
            <Icon name="whatsapp" size={18} />
            Avisar a los ganadores por WhatsApp
          </button>
          <div style={{ display: 'flex', gap: 10 }}>
            <Link to={`/s/${SORTEO.slug}/resultado`} className="rs-btn rs-btn--secundario" style={{ flex: 1 }}>Publicar en el enlace</Link>
            <button type="button" className="rs-btn rs-btn--secundario" style={{ flex: 1 }}>Descargar imagen</button>
          </div>
        </aside>
      </div>
    </>
  );
}
