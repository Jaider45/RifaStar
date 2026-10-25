import { Link } from 'react-router-dom';
import { Badge } from '@/components/Badge';
import { Icon } from '@/components/Icon';
import { PubFrame } from '@/components/PubFrame';
import { ORGANIZACION, SORTEO } from '@/data/mock';
import { cop } from '@/lib/format';
import './publico.css';

export default function Boletos() {
  const primerNombre = ORGANIZACION.propietaria.split(' ')[0];

  return (
    <PubFrame>
      <header className="pub-header pub-header--bar">
        <Link to={`/s/${SORTEO.slug}`} className="rs-btn rs-btn--secundario rs-btn--sm icon-btn" aria-label="Volver al sorteo">
          <Icon name="arrowLeft" strokeWidth={2.2} />
        </Link>
        <div className="header-titulo">Mis boletos</div>
      </header>

      <main className="pub-main">
        <form className="stack" style={{ gap: 10 }} onSubmit={(e) => e.preventDefault()}>
          <label className="rs-label" htmlFor="buscarwa" style={{ margin: 0 }}>Consulta con tu WhatsApp</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input id="buscarwa" className="rs-in rs-mono fill-in" defaultValue="300 412 7781" inputMode="tel" />
            <button className="rs-btn rs-btn--primario" type="submit">Buscar</button>
          </div>
        </form>

        <section className="stack" style={{ gap: 12 }}>
          <div className="fila-sb">
            <h2 className="h2 h2--sm">{SORTEO.nombreCorto}</h2>
            <Badge tono="abierto">Juega hoy</Badge>
          </div>
          <p className="header-sub" style={{ marginTop: -6 }}>{SORTEO.loteria} · {SORTEO.fechaTexto}</p>

          <article className="rs-card boleto">
            <div className="boleto__num boleto__num--pago">
              <span className="rs-mono">07</span>
            </div>
            <div className="boleto__info">
              <span className="boleto__estado boleto__estado--ok">
                <Icon name="check" size={16} strokeWidth={2.6} />
                Pago confirmado
              </span>
              <span className="boleto__meta">Boleto RS-0042-07 · {cop(SORTEO.precio)}</span>
            </div>
          </article>

          <article className="rs-card boleto">
            <div className="boleto__num">
              <span className="rs-mono">24</span>
            </div>
            <div className="boleto__info">
              <span className="boleto__estado boleto__estado--espera">
                <Icon name="clock" size={16} strokeWidth={2.4} />
                Verificando pago
              </span>
              <span className="boleto__meta">Comprobante enviado hace 4 min</span>
            </div>
          </article>

          <a href={`https://wa.me/${ORGANIZACION.whatsapp}`} className="rs-btn rs-btn--secundario" style={{ width: '100%' }}>
            <Icon name="whatsapp" size={18} />
            Escribir a {primerNombre}
          </a>
        </section>

        <section className="stack" style={{ gap: 12, paddingTop: 8, borderTop: '1px solid var(--linea)' }}>
          <h2 className="eyebrow" style={{ paddingTop: 12 }}>Sorteos anteriores</h2>

          <article className="rs-card ganaste">
            <div className="fila-sb">
              <span style={{ font: '700 15px/20px var(--font-sans)' }}>Sorteo semanal · 17 oct</span>
              <Badge tono="ganador">★ Ganaste</Badge>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span className="num-tag num-tag--oro" style={{ padding: '6px 12px', fontSize: 18 }}>58</span>
              <span className="muted" style={{ font: '500 14px/20px var(--font-sans)' }}>
                Dos últimas cifras · <b style={{ color: 'var(--tinta)' }}>{cop(200000)}</b>
              </span>
            </div>
            <span style={{ font: '500 13px/18px var(--font-sans)', color: 'var(--verde-texto)' }}>Premio entregado el 18 oct</span>
          </article>

          <article className="rs-card fila-sb" style={{ padding: 16, gap: 12 }}>
            <div>
              <div style={{ font: '700 15px/20px var(--font-sans)' }}>Sorteo semanal · 10 oct</div>
              <div className="boleto__meta">Jugaste con 13 y 31 · Cayó 4087</div>
            </div>
            <Badge tono="cerrado">Cerrado</Badge>
          </article>
        </section>
      </main>
    </PubFrame>
  );
}
