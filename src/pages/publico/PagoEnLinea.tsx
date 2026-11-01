import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { request } from '@/api/client';
import { Icon } from '@/components/Icon';
import { ErrorNote } from '@/components/ui';
import { cop } from '@/lib/format';
import { CardError, tokenizeCard } from '@/lib/wompi';

type Metodo = 'CARD' | 'NEQUI' | 'PSE' | 'BANCOLOMBIA_TRANSFER';

interface Checkout {
  enabled: boolean;
  environment?: 'sandbox' | 'production';
  publicKey?: string;
  tokenizeUrl?: string;
  methods?: Metodo[];
  amountCop?: number;
  contracts?: { terms: string; personalData: string };
  payment: PagoVista | null;
}

interface PagoVista {
  id: string;
  status: 'pending' | 'approved' | 'declined' | 'voided' | 'error';
  method: Metodo;
  amountCop: number;
  message: string | null;
  redirectUrl: string | null;
  final: boolean;
}

const ETIQUETA: Record<Metodo, string> = { CARD: 'Tarjeta', NEQUI: 'Nequi', PSE: 'PSE', BANCOLOMBIA_TRANSFER: 'Bancolombia' };
const DOCUMENTOS = [
  ['CC', 'Cédula de ciudadanía'],
  ['CE', 'Cédula de extranjería'],
  ['NIT', 'NIT'],
  ['TI', 'Tarjeta de identidad'],
  ['PP', 'Pasaporte'],
] as const;

/**
 * Pago en línea dentro de Rifa Star. Wompi procesa por detrás: el participante nunca ve su marca,
 * salvo los contratos que Wompi exige aceptar. Con PSE y Bancolombia se pasa un momento por el banco
 * y se vuelve a esta misma página.
 */
export function PagoEnLinea({ orderId, token, onApproved }: { orderId: string; token: string; onApproved: () => void }) {
  const headers = { 'X-Order-Token': token };
  const checkout = useQuery<Checkout>({
    queryKey: ['public-checkout', orderId],
    queryFn: () => request<Checkout>(`/v1/public/orders/${orderId}/checkout`, { headers }),
    retry: false,
  });
  const [metodo, setMetodo] = useState<Metodo | null>(null);
  const [pago, setPago] = useState<PagoVista | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const redirigido = useRef(false);

  // Campos comunes y de cada medio.
  const [email, setEmail] = useState('');
  const [terminos, setTerminos] = useState(false);
  const [datos, setDatos] = useState(false);
  const [tarjeta, setTarjeta] = useState({ number: '', holder: '', exp: '', cvc: '', cuotas: 1 });
  const [celular, setCelular] = useState('');
  const [pse, setPse] = useState({ userType: 0 as 0 | 1, legalIdType: 'CC', legalId: '', bankCode: '' });

  const c = checkout.data;
  // Un pago anterior en curso (volviste del banco o recargaste): se retoma.
  useEffect(() => {
    if (c?.payment && !pago) setPago(c.payment);
  }, [c, pago]);

  const bancos = useQuery<{ code: string; name: string }[]>({
    queryKey: ['public-banks', orderId],
    queryFn: () => request(`/v1/public/orders/${orderId}/checkout/banks`, { headers }),
    enabled: Boolean(c?.enabled && c.methods?.includes('PSE') && metodo === 'PSE'),
    staleTime: 3_600_000,
    retry: false,
  });

  // Mientras el pago esté en curso, se consulta cada 3 s (el servidor lo confirma con Wompi).
  const enCurso = pago?.status === 'pending';
  const estado = useQuery<{ payment: PagoVista | null }>({
    queryKey: ['public-payment', orderId, pago?.id],
    queryFn: () => request(`/v1/public/orders/${orderId}/payment`, { headers }),
    enabled: enCurso,
    refetchInterval: 3_000,
    retry: true,
  });
  useEffect(() => {
    const p = estado.data?.payment;
    if (p && p.id === pago?.id) setPago(p);
  }, [estado.data, pago?.id]);
  useEffect(() => {
    if (pago?.status === 'approved') onApproved();
  }, [pago?.status, onApproved]);
  // PSE / Bancolombia: cuando el banco entrega su página, se lleva al participante.
  useEffect(() => {
    if (pago?.status === 'pending' && pago.redirectUrl && !redirigido.current) {
      redirigido.current = true;
      window.location.assign(pago.redirectUrl);
    }
  }, [pago]);

  if (checkout.isLoading) return <p className="muted">Cargando medios de pago…</p>;
  if (!c?.enabled || !c.methods?.length) return null;
  const metodos = c.methods;
  const actual = metodo ?? metodos[0];

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!terminos || !datos) {
      setError(new Error('Acepta los dos contratos para continuar.'));
      return;
    }
    setBusy(true);
    redirigido.current = false;
    try {
      const base = { email: email.trim(), acceptTerms: true, acceptPersonalData: true };
      let body: object;
      if (actual === 'CARD') {
        const [mm, aa] = tarjeta.exp.split('/').map((s) => s.trim());
        const cardToken = await tokenizeCard({
          tokenizeUrl: c.tokenizeUrl!,
          publicKey: c.publicKey!,
          card: { number: tarjeta.number, holder: tarjeta.holder, cvc: tarjeta.cvc, expMonth: mm ?? '', expYear: aa ?? '' },
        });
        body = { ...base, method: 'CARD', cardToken, installments: tarjeta.cuotas };
      } else if (actual === 'NEQUI') {
        body = { ...base, method: 'NEQUI', phone: celular };
      } else if (actual === 'PSE') {
        body = { ...base, method: 'PSE', pse };
      } else {
        body = { ...base, method: 'BANCOLOMBIA_TRANSFER' };
      }
      setPago(await request<PagoVista>(`/v1/public/orders/${orderId}/pay`, { body, headers }));
    } catch (err) {
      setError(err instanceof CardError ? new Error(err.message) : err);
    } finally {
      setBusy(false);
    }
  };

  // --- Esperando al banco o a la app -------------------------------------------
  if (pago?.status === 'pending') {
    return (
      <section className="rs-card stack" style={{ padding: 16, gap: 10 }} aria-live="polite">
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <Icon name="clock" strokeWidth={2.4} />
          <b>{pago.method === 'NEQUI' ? 'Aprueba el pago en tu app de Nequi' : pago.redirectUrl ? 'Te estamos llevando a tu banco…' : 'Estamos confirmando tu pago…'}</b>
        </div>
        <p className="muted" style={{ margin: 0 }}>
          {pago.method === 'NEQUI'
            ? 'Te llegó una notificación a Nequi. Cuando la apruebes, esta página se actualiza sola.'
            : 'No cierres esta página. Se actualiza sola apenas se confirme.'}
        </p>
        {pago.redirectUrl && (
          <a className="rs-btn rs-btn--primario boton-ancho" href={pago.redirectUrl}>Ir a mi banco</a>
        )}
      </section>
    );
  }

  const fallo = pago && pago.status !== 'approved';
  return (
    <form className="stack" style={{ gap: 12 }} onSubmit={enviar}>
      {fallo && (
        <div className="note note--alerta" role="alert">
          <Icon name="info" size={18} style={{ flex: 'none' }} />
          <span>{pago.message ? `${pago.message}. ` : ''}No se hizo ningún cobro. Prueba de nuevo o con otro medio.</span>
        </div>
      )}
      {metodos.length > 1 && (
        <div role="tablist" aria-label="Medio de pago en línea" className="segmento">
          {metodos.map((m) => (
            <button key={m} type="button" role="tab" aria-selected={actual === m} className="rs-btn rs-btn--sm" onClick={() => { setMetodo(m); setError(null); }}>
              {ETIQUETA[m]}
            </button>
          ))}
        </div>
      )}

      <div>
        <label className="rs-label" htmlFor="po-email">Correo para el recibo</label>
        <input id="po-email" type="email" className="rs-in fill-in" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
      </div>

      {actual === 'CARD' && (
        <>
          <div>
            <label className="rs-label" htmlFor="po-num">Número de la tarjeta</label>
            <input id="po-num" className="rs-in rs-mono fill-in" inputMode="numeric" autoComplete="cc-number" value={tarjeta.number} onChange={(e) => setTarjeta({ ...tarjeta, number: e.target.value.replace(/[^\d ]/g, '').slice(0, 23) })} placeholder="1234 5678 9012 3456" required />
          </div>
          <div>
            <label className="rs-label" htmlFor="po-nom">Nombre en la tarjeta</label>
            <input id="po-nom" className="rs-in fill-in" autoComplete="cc-name" value={tarjeta.holder} onChange={(e) => setTarjeta({ ...tarjeta, holder: e.target.value })} required />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1 }}>
              <label className="rs-label" htmlFor="po-exp">Vence (MM/AA)</label>
              <input id="po-exp" className="rs-in rs-mono fill-in" inputMode="numeric" autoComplete="cc-exp" placeholder="MM/AA" maxLength={7} value={tarjeta.exp} onChange={(e) => setTarjeta({ ...tarjeta, exp: e.target.value.replace(/[^\d/]/g, '') })} required />
            </div>
            <div style={{ flex: 1 }}>
              <label className="rs-label" htmlFor="po-cvc">Código (CVC)</label>
              <input id="po-cvc" className="rs-in rs-mono fill-in" inputMode="numeric" autoComplete="cc-csc" maxLength={4} value={tarjeta.cvc} onChange={(e) => setTarjeta({ ...tarjeta, cvc: e.target.value.replace(/\D/g, '') })} required />
            </div>
          </div>
          <div>
            <label className="rs-label" htmlFor="po-cuotas">Cuotas</label>
            <select id="po-cuotas" className="rs-in fill-in" value={tarjeta.cuotas} onChange={(e) => setTarjeta({ ...tarjeta, cuotas: Number(e.target.value) })}>
              {[1, 2, 3, 6, 12, 24, 36].map((n) => <option key={n} value={n}>{n === 1 ? 'De contado' : `${n} cuotas`}</option>)}
            </select>
          </div>
        </>
      )}

      {actual === 'NEQUI' && (
        <div>
          <label className="rs-label" htmlFor="po-cel">Celular de Nequi</label>
          <input id="po-cel" className="rs-in rs-mono fill-in" inputMode="tel" autoComplete="tel-national" value={celular} onChange={(e) => setCelular(e.target.value)} placeholder="300 123 4567" required />
          <p className="rs-help">Te llega una notificación a la app para aprobar el pago.</p>
        </div>
      )}

      {actual === 'PSE' && (
        <>
          <div>
            <label className="rs-label" htmlFor="po-banco">Tu banco</label>
            <select id="po-banco" className="rs-in fill-in" value={pse.bankCode} onChange={(e) => setPse({ ...pse, bankCode: e.target.value })} required>
              <option value="">{bancos.isLoading ? 'Cargando bancos…' : 'Elige tu banco'}</option>
              {(bancos.data ?? []).map((b) => <option key={b.code} value={b.code}>{b.name}</option>)}
            </select>
          </div>
          <div>
            <label className="rs-label" htmlFor="po-tipo">Tipo de persona</label>
            <select id="po-tipo" className="rs-in fill-in" value={pse.userType} onChange={(e) => setPse({ ...pse, userType: Number(e.target.value) as 0 | 1 })}>
              <option value={0}>Natural</option>
              <option value={1}>Jurídica</option>
            </select>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1 }}>
              <label className="rs-label" htmlFor="po-doc">Documento</label>
              <select id="po-doc" className="rs-in fill-in" value={pse.legalIdType} onChange={(e) => setPse({ ...pse, legalIdType: e.target.value })}>
                {DOCUMENTOS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label className="rs-label" htmlFor="po-docn">Número</label>
              <input id="po-docn" className="rs-in rs-mono fill-in" inputMode="numeric" value={pse.legalId} onChange={(e) => setPse({ ...pse, legalId: e.target.value.replace(/\D/g, '') })} required />
            </div>
          </div>
          <p className="rs-help">Te llevamos a tu banco para autorizar el pago y luego vuelves aquí.</p>
        </>
      )}

      {actual === 'BANCOLOMBIA_TRANSFER' && (
        <p className="rs-help" style={{ margin: 0 }}>Te llevamos al Botón Bancolombia para autorizar el pago y luego vuelves aquí.</p>
      )}

      <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', font: '500 13px/18px var(--font-sans)' }}>
        <input type="checkbox" checked={terminos} onChange={(e) => setTerminos(e.target.checked)} style={{ marginTop: 2 }} />
        <span>Acepto los <a href={c.contracts?.terms} target="_blank" rel="noreferrer" className="strong-link">términos y condiciones</a> del procesador de pagos.</span>
      </label>
      <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', font: '500 13px/18px var(--font-sans)' }}>
        <input type="checkbox" checked={datos} onChange={(e) => setDatos(e.target.checked)} style={{ marginTop: 2 }} />
        <span>Autorizo el <a href={c.contracts?.personalData} target="_blank" rel="noreferrer" className="strong-link">tratamiento de mis datos personales</a>.</span>
      </label>

      {c.environment === 'sandbox' && (
        <p className="note note--fondo" style={{ margin: 0 }}>Modo de pruebas: no se hace ningún cobro real.</p>
      )}
      <ErrorNote error={error} />
      <button type="submit" className="rs-btn rs-btn--primario boton-ancho" disabled={busy}>
        {busy ? 'Procesando…' : `Pagar ${cop(c.amountCop ?? 0)}`}
      </button>
      <p className="texto-pie">Pago seguro. Los datos de tu tarjeta van cifrados al procesador y no se guardan en Rifa Star.</p>
    </form>
  );
}
