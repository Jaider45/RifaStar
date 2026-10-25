import { Link } from 'react-router-dom';
import { Badge } from '@/components/Badge';
import { Logo } from '@/components/Logo';
import { PubFrame } from '@/components/PubFrame';
import { ORGANIZACION, RANKING_CIERRA, RANKING_MES, SORTEO } from '@/data/mock';
import { pad } from '@/lib/format';
import { useCountdown } from '@/lib/useCountdown';
import './publico.css';

/** En público: nombre e inicial (configurable en Ajustes › Ranking). */
const corto = (nombre: string) => {
  const [n, a] = nombre.split(' ');
  return a ? `${n} ${a[0]}.` : n;
};

const PODIO = RANKING_MES.slice(0, 3);
const PREMIO_CORTO = ['$300.000', '10 números gratis', '5 números gratis'];

/** Puestos 4–11 y la fila del participante que consulta (puesto 12). */
const FILAS = [
  ...RANKING_MES.slice(3, 10).map((f, i) => ({ pos: i + 4, nombre: corto(f.nombre), puntos: f.puntos, tu: false })),
  { pos: 11, nombre: 'Óscar M.', puntos: 13, tu: false },
  { pos: 12, nombre: 'Tú · Laura P.', puntos: 11, tu: true },
];

export default function RankingPublico() {
  const r = useCountdown(RANKING_CIERRA);
  // Orden visual del podio: 2.º, 1.º, 3.º
  const columnas = [
    { f: PODIO[1], puesto: 2, alto: 108, size: 34, pad: 12 },
    { f: PODIO[0], puesto: 1, alto: 148, size: 44, pad: 14 },
    { f: PODIO[2], puesto: 3, alto: 84, size: 30, pad: 10 },
  ];

  return (
    <PubFrame>
      <header className="pub-header">
        <Logo variante="blanco" className="pub-header__logo" />
        <Link to="/mis-boletos" className="rs-btn rs-btn--secundario rs-btn--sm" style={{ minHeight: 44 }}>Mis boletos</Link>
      </header>

      <main className="pub-main pub-main--tight">
        <section className="stack" style={{ gap: 8 }}>
          <span className="eyebrow">{ORGANIZACION.nombre}</span>
          <h1 className="pub-title" style={{ fontSize: 34, lineHeight: '34px' }}>Ranking de octubre</h1>
          <p className="muted" style={{ font: '500 14px/20px var(--font-sans)' }}>
            Cada número pagado suma 1 punto. Los 3 primeros ganan premio al cerrar el mes.
          </p>
        </section>

        <section className="rs-card fila-sb" style={{ padding: '14px 16px', gap: 12 }}>
          <span className="muted" style={{ font: '600 14px/20px var(--font-sans)' }}>Cierra el 31 oct</span>
          <span className="rs-mono" style={{ fontSize: 20, lineHeight: '24px', fontWeight: 700 }} aria-label={`Faltan ${r.dias} días y ${r.horas} horas`}>
            {r.dias}d · {r.horas}h · {pad(r.minutos)}m
          </span>
        </section>

        <section aria-label="Primeros tres puestos" className="podio">
          {columnas.map(({ f, puesto, alto, size, pad: padTop }) => (
            <div key={puesto} className="podio__col">
              {puesto === 1 && <Badge tono="ganador">★ Líder</Badge>}
              <span className="podio__nombre" style={puesto === 1 ? { fontSize: 15 } : undefined}>{corto(f.nombre)}</span>
              <span className="rs-mono podio__pts">{f.puntos} pts</span>
              <div className={`podio__bloque${puesto === 1 ? ' podio__bloque--oro' : ''}`} style={{ height: alto, paddingTop: padTop }}>
                <span className="rs-display podio__puesto" style={{ fontSize: size, lineHeight: `${size}px` }}>{puesto}</span>
                <span className="podio__premio">
                  {puesto === 2 ? <>10 números<br />gratis</> : PREMIO_CORTO[puesto - 1]}
                </span>
              </div>
            </div>
          ))}
        </section>

        <section className="tu-puesto">
          <span className="rs-display tu-puesto__n">12</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ font: '800 15px/20px var(--font-sans)' }}>Vas en el puesto 12</div>
            <div style={{ font: '600 13px/18px var(--font-sans)' }}>Te faltan 4 puntos para el top 10</div>
          </div>
        </section>

        <section className="rs-card list-card">
          {FILAS.map((f, i) => (
            <div key={f.pos} className={`rank-row${i === FILAS.length - 2 ? ' rank-row--corte' : ''}${f.tu ? ' rank-row--tu' : ''}`}>
              <span className="rs-mono rank-row__pos">{f.pos}</span>
              <span className="rank-row__nombre">{f.nombre}</span>
              <span className="rs-mono" style={{ fontWeight: 700 }}>{f.puntos}</span>
            </div>
          ))}
        </section>

        <form className="stack" style={{ gap: 8 }} onSubmit={(e) => e.preventDefault()}>
          <label className="rs-label" htmlFor="rwa" style={{ margin: 0 }}>¿No te ves? Consulta tu posición</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input id="rwa" className="rs-in rs-mono fill-in" placeholder="Tu WhatsApp" inputMode="tel" />
            <button type="submit" className="rs-btn rs-btn--secundario">Buscar</button>
          </div>
        </form>

        <Link to={`/s/${SORTEO.slug}`} className="rs-btn rs-btn--primario boton-ancho">Suma puntos en el sorteo de hoy</Link>

        <p className="texto-pie" style={{ fontSize: 12, lineHeight: '16px' }}>
          Solo cuentan números pagos y verificados. Empate: gana quien llegó primero. El ranking se reinicia el día 1 de cada mes.
        </p>
      </main>
    </PubFrame>
  );
}
