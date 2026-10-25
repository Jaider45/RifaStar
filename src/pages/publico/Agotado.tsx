import { Link } from 'react-router-dom';
import { Badge } from '@/components/Badge';
import { Icon } from '@/components/Icon';
import { Logo } from '@/components/Logo';
import { PubFrame } from '@/components/PubFrame';
import { ORGANIZACION, SORTEO } from '@/data/mock';
import { cop } from '@/lib/format';
import './publico.css';

const RESULTADO = '4058';

/** Ganadores con nombre corto y WhatsApp enmascarado (nunca el número completo en público). */
const GANADORES = [
  { numero: '58', nombre: 'Laura M. · ***7781' },
  { numero: '40', nombre: 'Carlos R. · ***2290' },
  { numero: '05', nombre: 'Yeni P. · ***6614' },
  { numero: '48', nombre: 'Andrés G. · ***0937' },
  { numero: '73', nombre: 'Marta L. · ***4412' },
].map((g, i) => ({ ...g, premio: SORTEO.premios[i] }));

export default function Agotado() {
  return (
    <PubFrame>
      <header className="pub-header">
        <Logo variante="blanco" className="pub-header__logo" />
        <Link to="/mis-boletos" className="rs-btn rs-btn--secundario rs-btn--sm" style={{ minHeight: 44 }}>Mis boletos</Link>
      </header>

      <main className="pub-main pub-main--tight">
        <section className="stack" style={{ gap: 8 }}>
          <Badge tono="cerrado" style={{ alignSelf: 'flex-start' }}>Agotado</Badge>
          <h1 className="pub-title" style={{ fontSize: 30, lineHeight: '32px' }}>
            {SORTEO.tituloLineas[0]}<br />{SORTEO.tituloLineas[1]}
          </h1>
          <p className="venta__meta">{SORTEO.loteria} · {SORTEO.fechaTexto}</p>
        </section>

        <section className="rs-card agotado">
          <div aria-hidden="true" className="agotado__icono">
            <Icon name="check" size={32} strokeWidth={3} />
          </div>
          <h2 className="pub-title" style={{ fontSize: 24, lineHeight: '28px' }}>¡Se vendieron los {SORTEO.total} números!</h2>
          <p className="muted" style={{ font: '500 15px/22px var(--font-sans)' }}>
            Gracias a todos los que participaron. Aquí publicamos los ganadores apenas salga el resultado.
          </p>
        </section>

        <section className="stack" style={{ gap: 12 }}>
          <div className="fila-sb">
            <h2 className="h2" style={{ lineHeight: '26px' }}>Resultado</h2>
            <Badge tono="ganador">★ Ganadores</Badge>
          </div>
          <div className="rs-card stack" style={{ padding: 16, gap: 12 }}>
            <span className="muted" style={{ font: '600 13px/18px var(--font-sans)' }}>Número de la {SORTEO.loteria}</span>
            <div className="digitos" aria-label={`Resultado ${RESULTADO}`}>
              {RESULTADO.split('').map((d, i) => (
                <span key={i} className="rs-mono" aria-hidden="true">{d}</span>
              ))}
            </div>
            <a href="#resultado-oficial" className="small-link">Ver resultado oficial</a>
          </div>

          <div className="rs-card list-card">
            {GANADORES.map((g, i) => (
              <div key={g.numero} className="list-row">
                <span className={`rs-mono ganador-num${i === 0 ? ' ganador-num--oro' : ''}`}>{g.numero}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ font: '700 15px/20px var(--font-sans)' }}>{g.nombre}</div>
                  <div className="header-sub">{g.premio.etiqueta ?? g.premio.regla}</div>
                </div>
                <span className="rs-display" style={{ fontSize: 17, lineHeight: '22px', fontWeight: 800, whiteSpace: 'nowrap' }}>
                  {cop(g.premio.monto)}
                </span>
              </div>
            ))}
          </div>
        </section>

        <section className="proximo">
          <span className="venta__eyebrow">Próximo sorteo</span>
          <span className="rs-display" style={{ fontSize: 26, lineHeight: '28px', fontWeight: 800 }}>Sábado 31 de octubre</span>
          <span style={{ font: '500 14px/20px var(--font-sans)' }}>Te avisamos por WhatsApp cuando abra la venta.</span>
          <a href={`https://wa.me/${ORGANIZACION.whatsapp}`} className="rs-btn proximo__btn">Avísame</a>
        </section>
      </main>
    </PubFrame>
  );
}
