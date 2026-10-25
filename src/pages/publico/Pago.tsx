import { useMemo, useState, type FormEvent } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { ApiError, request, uploadToStorage } from '@/api/client';
import { usePublicQuery } from '@/api/hooks';
import type { Upload } from '@/api/types';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Icon } from '@/components/Icon';
import { PubFrame } from '@/components/PubFrame';
import { ErrorNote } from '@/components/ui';
import { cop, pad } from '@/lib/format';
import { useCountdown } from '@/lib/useCountdown';
import { clearOrder, linkCodes, PubError, PubLoading, readOrder, saveOrder, type PublicRaffle } from './shared';
import './publico.css';

interface PublicOrder {
  orderId: string;
  status: 'reserved' | 'pending_verification' | 'approved' | 'rejected' | 'expired' | 'released';
  statusLabel: string;
  numbers: string[];
  totalCop: number;
  reservedUntil: string;
  receiptUploaded: boolean;
  requireReceipt: boolean;
  rejectionReason: string | null;
  tickets: { code: string; number: string }[];
  paymentAccounts: { id: string; typeLabel: string; keyOrNumber: string; holderName: string; bankName: string | null; accountKind: string | null }[];
}

function BotonCopiar({ texto }: { texto: string }) {
  const [copiado, setCopiado] = useState(false);
  return (
    <button
      type="button"
      className="rs-btn rs-btn--secundario rs-btn--sm"
      onClick={() => {
        navigator.clipboard?.writeText(texto).catch(() => undefined);
        setCopiado(true);
        window.setTimeout(() => setCopiado(false), 1600);
      }}
    >
      <Icon name={copiado ? 'check' : 'copy'} size={16} />
      {copiado ? 'Copiado' : 'Copiar'}
    </button>
  );
}

function Apartado({ hasta }: { hasta: string }) {
  const r = useCountdown(new Date(hasta).getTime());
  return (
    <div className="note note--alerta" role="status">
      <Icon name="timer" strokeWidth={2.2} style={{ flex: 'none' }} />
      <span>
        {r.total > 0 ? (
          <>Tus números están apartados por <b className="rs-mono">{r.horas > 0 ? `${r.horas}:` : ''}{pad(r.minutos)}:{pad(r.segundos)}</b>. Paga y sube el comprobante antes de que se liberen.</>
        ) : (
          'El tiempo de apartado terminó.'
        )}
      </span>
    </div>
  );
}

export default function Pago() {
  const { org = '', sorteo = '' } = useParams();
  const location = useLocation();
  const qc = useQueryClient();
  const elegidos: number[] = (location.state as { numeros?: number[] } | null)?.numeros ?? [];
  const raffle = usePublicQuery<PublicRaffle>(`/v1/public/orgs/${org}/raffles/${sorteo}`);
  const [stored, setStored] = useState(() => readOrder(org, sorteo));
  const order = useQuery<PublicOrder>({
    queryKey: ['public-order', stored?.orderId],
    queryFn: () => request<PublicOrder>(`/v1/public/orders/${stored!.orderId}`, { headers: { 'X-Order-Token': stored!.accessToken } }),
    enabled: Boolean(stored),
    refetchInterval: (q) => (q.state.data?.status === 'pending_verification' ? 20_000 : false),
    retry: false,
  });

  const [nombre, setNombre] = useState('');
  const [wa, setWa] = useState('');
  const [medio, setMedio] = useState(0);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const idempotencyKey = useMemo(() => crypto.randomUUID(), []);

  if (raffle.isLoading || (stored && order.isLoading)) return <PubLoading />;
  if (raffle.error || !raffle.data) return <PubError error={raffle.error} />;
  const { raffle: r, organization } = raffle.data;
  const cifras = r.digits;
  const o = order.data;
  const primerNombre = organization.name.split(' ')[0];

  const nuevaCompra = () => {
    clearOrder(org, sorteo);
    setStored(null);
  };

  const apartar = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await request<{ orderId: string; accessToken: string }>(`/v1/public/orgs/${org}/raffles/${sorteo}/orders`, {
        body: { name: nombre.trim(), phone: wa, numbers: elegidos, ...linkCodes(org) },
        headers: { 'Idempotency-Key': idempotencyKey },
      });
      const s = { orderId: res.orderId, accessToken: res.accessToken };
      saveOrder(org, sorteo, s);
      setStored(s);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const enviar = async () => {
    if (!o || !stored) return;
    setBusy(true);
    setError(null);
    const headers = { 'X-Order-Token': stored.accessToken };
    try {
      let key: string | undefined;
      if (archivo) {
        const up = await request<Upload>(`/v1/public/orders/${o.orderId}/receipt`, { body: { contentType: archivo.type, size: archivo.size }, headers });
        await uploadToStorage(up, archivo);
        key = up.key;
      }
      await request(`/v1/public/orders/${o.orderId}/receipt/confirm`, { body: key ? { key } : {}, headers });
      await qc.invalidateQueries({ queryKey: ['public-order', o.orderId] });
      setArchivo(null);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  // --- Sin orden: datos del participante para apartar -------------------------
  if (!stored || !o) {
    if (elegidos.length === 0) {
      return (
        <PubFrame acento={r.accentColor}>
          <main className="pub-main">
            <p className="muted">Primero elige tus números.</p>
            <Link to={`/${org}/${sorteo}`} className="rs-btn rs-btn--primario boton-ancho">Elegir números</Link>
          </main>
        </PubFrame>
      );
    }
    const tomados = error instanceof ApiError && error.code === 'NUMBERS_TAKEN';
    return (
      <PubFrame acento={r.accentColor}>
        <Cabecera org={org} sorteo={sorteo} titulo={r.title} />
        <main className="pub-main">
          <ol aria-label="Pasos de compra" className="pasos-compra">
            <li>1 · Números</li>
            <li aria-current="step">2 · Tus datos</li>
            <li>3 · Pago</li>
          </ol>
          <section className="rs-card resumen-pago">
            <div className="fila-sb">
              <span style={{ font: '700 15px/20px var(--font-sans)' }}>Tus números</span>
              <Link to={`/${org}/${sorteo}`} className="strong-link">Cambiar</Link>
            </div>
            <div className="chips">
              {elegidos.map((n) => <span key={n} className="rs-mono boleto-chip">{pad(n, cifras)}</span>)}
            </div>
            <div className="resumen-pago__total">
              <span>{elegidos.length} × {cop(r.pricePerNumber)}</span>
              <span className="rs-display">{cop(elegidos.length * r.pricePerNumber)}</span>
            </div>
          </section>
          <form className="stack" style={{ gap: 14 }} onSubmit={apartar}>
            <h2 className="h2 h2--sm">Tus datos</h2>
            <div>
              <label className="rs-label" htmlFor="nombre">Nombre completo</label>
              <input id="nombre" className="rs-in fill-in" value={nombre} onChange={(e) => setNombre(e.target.value)} autoComplete="name" required minLength={2} />
            </div>
            <div>
              <label className="rs-label" htmlFor="wa">WhatsApp</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <span className="rs-in rs-mono fill-in" style={{ width: 76, flex: 'none', display: 'flex', alignItems: 'center' }}>+57</span>
                <input id="wa" className="rs-in rs-mono fill-in" value={wa} onChange={(e) => setWa(e.target.value)} inputMode="tel" autoComplete="tel-national" required placeholder="300 412 7781" />
              </div>
              <p className="rs-help">Aquí te llega la confirmación y tu boleto.</p>
            </div>
            <ErrorNote error={error} />
            {tomados ? (
              <Link to={`/${org}/${sorteo}`} className="rs-btn rs-btn--primario boton-ancho">Elegir otros números</Link>
            ) : (
              <button type="submit" className="rs-btn rs-btn--primario boton-ancho" disabled={busy}>{busy ? 'Apartando…' : 'Apartar mis números'}</button>
            )}
          </form>
        </main>
      </PubFrame>
    );
  }

  // --- Orden pagada, en verificación o cerrada -------------------------------
  if (o.status !== 'reserved') {
    const ok = o.status === 'approved';
    const espera = o.status === 'pending_verification';
    return (
      <PubFrame acento={r.accentColor}>
        <Cabecera org={org} sorteo={sorteo} titulo={r.title} />
        <main className="pub-main">
          <section className="rs-card agotado">
            <div aria-hidden="true" className="agotado__icono"><Icon name={ok ? 'check' : espera ? 'clock' : 'info'} size={32} strokeWidth={3} /></div>
            <h1 className="pub-title" style={{ fontSize: 24, lineHeight: '28px' }}>
              {ok ? '¡Pago confirmado!' : espera ? 'Estamos verificando tu pago' : o.status === 'rejected' ? 'No pudimos aprobar tu pago' : 'Tu apartado venció'}
            </h1>
            <p className="muted" style={{ font: '500 15px/22px var(--font-sans)' }}>
              {ok
                ? 'Tus boletos ya están en «Mis boletos». También te los enviamos por WhatsApp.'
                : espera
                  ? `${primerNombre} revisa el pago y te confirma por WhatsApp. Suele tardar menos de 15 minutos.`
                  : o.status === 'rejected'
                    ? `Motivo: ${o.rejectionReason}. Tus números quedaron libres.`
                    : 'Los números se liberaron. Puedes volver a elegirlos si siguen libres.'}
            </p>
            <div className="chips">
              {(ok ? o.tickets.map((t) => t.number) : o.numbers).map((n) => <span key={n} className="rs-mono boleto-chip">{n}</span>)}
            </div>
          </section>
          {ok || espera ? (
            <Link to={`/${org}/mis-boletos`} className="rs-btn rs-btn--primario boton-ancho">Ver mis boletos</Link>
          ) : (
            <Link to={`/${org}/${sorteo}`} className="rs-btn rs-btn--primario boton-ancho" onClick={nuevaCompra}>Elegir números</Link>
          )}
          {espera && o.requireReceipt && (
            <p className="texto-pie">¿Subiste el comprobante equivocado? Puedes reemplazarlo:{' '}
              <label className="strong-link" style={{ cursor: 'pointer' }}>
                elegir otro
                <input type="file" accept="image/*,application/pdf" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) { setArchivo(f); } }} />
              </label>
              {archivo && <button type="button" className="rs-btn rs-btn--secundario rs-btn--sm" onClick={enviar} disabled={busy}>Enviar {archivo.name}</button>}
            </p>
          )}
          <ErrorNote error={error} />
        </main>
      </PubFrame>
    );
  }

  // --- Apartada: pagar y subir comprobante -----------------------------------
  const cuentas = o.paymentAccounts;
  const m = cuentas[medio] ?? cuentas[0];
  return (
    <PubFrame acento={r.accentColor}>
      <Cabecera org={org} sorteo={sorteo} titulo={r.title} />
      <main className="pub-main">
        <ol aria-label="Pasos de compra" className="pasos-compra">
          <li>1 · Números</li>
          <li>2 · Tus datos</li>
          <li aria-current="step">3 · Pago</li>
        </ol>
        <Apartado hasta={o.reservedUntil} />
        <section className="rs-card resumen-pago">
          <div className="fila-sb">
            <span style={{ font: '700 15px/20px var(--font-sans)' }}>Tus números</span>
            <button type="button" className="strong-link rs-btn rs-btn--fantasma rs-btn--sm" onClick={nuevaCompra}>Empezar de nuevo</button>
          </div>
          <div className="chips">
            {o.numbers.map((n) => <span key={n} className="rs-mono boleto-chip">{n}</span>)}
          </div>
          <div className="resumen-pago__total">
            <span>{o.numbers.length} × {cop(r.pricePerNumber)}</span>
            <span className="rs-display">{cop(o.totalCop)}</span>
          </div>
        </section>

        <section className="stack" style={{ gap: 14 }}>
          <h2 className="h2 h2--sm">Paga {cop(o.totalCop)}</h2>
          {cuentas.length > 1 && (
            <div role="tablist" aria-label="Medio de pago" className="segmento">
              {cuentas.map((x, i) => (
                <button key={x.id} type="button" role="tab" aria-selected={medio === i} className="rs-btn rs-btn--sm" onClick={() => setMedio(i)}>{x.typeLabel}</button>
              ))}
            </div>
          )}
          {m && (
            <div className="rs-card list-card" role="tabpanel" aria-label={m.typeLabel}>
              <div className="list-row">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="dato-label">{m.typeLabel}{m.bankName ? ` · ${m.bankName} (${m.accountKind})` : ''}</div>
                  <div className="rs-mono dato-mono">{m.keyOrNumber}</div>
                </div>
                <BotonCopiar texto={m.keyOrNumber.replace(/\s/g, '')} />
              </div>
              <div className="list-row">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="dato-label">Titular</div>
                  <div className="dato-txt">{m.holderName}</div>
                </div>
              </div>
              <div className="list-row">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="dato-label">Valor exacto</div>
                  <div className="rs-mono dato-mono">{o.totalCop}</div>
                </div>
                <BotonCopiar texto={String(o.totalCop)} />
              </div>
            </div>
          )}
        </section>

        <section className="stack" style={{ gap: 12 }}>
          <h2 className="h2 h2--sm">{o.requireReceipt ? 'Sube el comprobante' : 'Cuando hayas pagado'}</h2>
          <label className="subir">
            <Icon name="upload" size={28} style={{ color: 'var(--verde-texto)' }} />
            <span className="subir__t">{archivo?.name ?? 'Toca para subir la captura'}</span>
            <span className="subir__d">{archivo ? 'Toca para cambiarla' : `Imagen o PDF del pago de ${cop(o.totalCop)} · máx. 10 MB`}</span>
            <input type="file" accept="image/jpeg,image/png,image/webp,image/heic,application/pdf" className="sr-only" onChange={(e) => setArchivo(e.target.files?.[0] ?? null)} />
          </label>
          <ErrorNote error={error} />
          <button type="button" className="rs-btn rs-btn--primario boton-ancho" disabled={busy || (o.requireReceipt && !archivo)} onClick={enviar}>
            {busy ? 'Enviando…' : archivo ? 'Enviar comprobante' : 'Ya pagué'}
          </button>
          <p className="texto-pie">{primerNombre} verifica el pago y te confirma por WhatsApp. Suele tardar menos de 15 minutos.</p>
        </section>
      </main>
    </PubFrame>
  );
}

function Cabecera({ org, sorteo, titulo }: { org: string; sorteo: string; titulo: string }) {
  return (
    <header className="pub-header pub-header--bar">
      <Link to={`/${org}/${sorteo}`} className="rs-btn rs-btn--secundario rs-btn--sm icon-btn" aria-label="Volver a los números">
        <Icon name="arrowLeft" strokeWidth={2.2} />
      </Link>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="header-titulo">Pagar mis números</div>
        <div className="header-sub">{titulo}</div>
      </div>
    </header>
  );
}
