import { useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '@/components/PageHeader';
import { ORGANIZACION, PREMIOS_RANKING, RANKING_CIERRA, RANKING_MES } from '@/data/mock';
import { cop } from '@/lib/format';
import { useCountdown } from '@/lib/useCountdown';
import './Ranking.css';

export default function Ranking() {
  const [busqueda, setBusqueda] = useState('');
  const r = useCountdown(RANKING_CIERRA);
  const q = busqueda.trim().toLowerCase();
  const filas = RANKING_MES.map((f, i) => ({ ...f, pos: i + 1 })).filter((f) => !q || f.nombre.toLowerCase().includes(q));
  const enlace = `rifastar.co/${ORGANIZACION.slug}/ranking`;

  return (
    <>
      <PageHeader
        title="Ranking de octubre"
        sub="1 punto por cada número pagado en el mes. Se reinicia el 1 de noviembre a las 12:00 a. m."
        actions={
          <>
            <select className="rs-in" aria-label="Mes" style={{ width: 180 }}>
              <option>Octubre 2026</option>
              <option>Septiembre 2026</option>
              <option>Agosto 2026</option>
            </select>
            <Link to="/admin/ajustes" className="rs-btn rs-btn--secundario">Configurar</Link>
          </>
        }
      />

      <section className="ranking-resumen">
        <div className="rs-panel kpi">
          <span className="kpi__label">Se reinicia en</span>
          <span className="rs-mono ranking-resumen__reloj">{r.dias} d {r.horas} h</span>
          <span className="kpi__note">El ranking de octubre queda guardado en el historial.</span>
        </div>
        <div className="rs-panel kpi">
          <span className="kpi__label">Participantes en el ranking</span>
          <span className="kpi__value" style={{ fontSize: 30 }}>214</span>
          <span className="kpi__note kpi__note--ok">+31 desde la semana pasada</span>
        </div>
        <div className="rs-panel kpi ranking-resumen__enlace">
          <span className="kpi__label">Enlace público del ranking</span>
          <div className="ranking-enlace">
            <span className="rs-mono ranking-enlace__url">{enlace}</span>
            <button type="button" className="rs-btn rs-btn--primario rs-btn--sm" onClick={() => navigator.clipboard?.writeText(`https://${enlace}`)}>
              Copiar
            </button>
            <Link to={`/r/${ORGANIZACION.slug}`} className="rs-btn rs-btn--secundario rs-btn--sm">Ver</Link>
          </div>
        </div>
      </section>

      <div className="split">
        <section className="rs-panel overflow-hidden" style={{ flex: '999 1 560px', minWidth: 0 }}>
          <div className="panel-head">
            <h2 className="h2">Posiciones</h2>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <input
                className="rs-in"
                placeholder="Buscar participante"
                aria-label="Buscar participante"
                style={{ width: 220 }}
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
              />
              <button type="button" className="rs-btn rs-btn--secundario rs-btn--sm">Exportar CSV</button>
            </div>
          </div>
          <div className="table-scroll">
            <table className="rs-tabla" style={{ minWidth: 620 }}>
              <thead>
                <tr><th style={{ width: 64 }}>#</th><th>Participante</th><th>Puntos</th><th>Sorteos</th><th>Invertido</th><th>Semana</th></tr>
              </thead>
              <tbody>
                {filas.map((f) => (
                  <tr key={f.nombre}>
                    <td>
                      <span className={`rs-mono pos pos--${f.pos === 1 ? 'oro' : f.pos <= 3 ? 'podio' : 'resto'}`}>{f.pos}</span>
                    </td>
                    <td>
                      <b>{f.nombre}</b><br />
                      <span className="cell-sub" style={{ fontSize: 13 }}>{f.wa}</span>
                    </td>
                    <td className="td-mono">{f.puntos}</td>
                    <td>{f.sorteos}</td>
                    <td className="rs-mono">{cop(f.invertido)}</td>
                    <td className={`cambio cambio--${f.cambio > 0 ? 'sube' : f.cambio < 0 ? 'baja' : 'igual'}`}>
                      {f.cambio > 0 ? `▲ ${f.cambio}` : f.cambio < 0 ? `▼ ${Math.abs(f.cambio)}` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <aside className="rs-panel premios-mes">
          <div>
            <h2 className="h2 h2--sm">Premios del mes</h2>
            <p className="rs-help">Se entregan al cerrar el ranking. Edítalos en Ajustes.</p>
          </div>
          {PREMIOS_RANKING.map((p, i) => (
            <div key={p} className="premios-mes__fila">
              <span className={`rs-mono premios-mes__pos${i === 0 ? ' premios-mes__pos--oro' : ''}`}>{i + 1}</span>
              <span className="premios-mes__txt">{p}</span>
            </div>
          ))}
          <div className="note note--fondo">Empate: gana quien llegó primero a esos puntos.</div>
          <button type="button" className="rs-btn rs-btn--secundario">Anunciar top 10 por WhatsApp</button>
        </aside>
      </div>
    </>
  );
}
