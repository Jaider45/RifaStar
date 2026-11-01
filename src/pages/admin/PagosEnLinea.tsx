import { useState, type FormEvent } from 'react';
import { useCan, useOrgMutation, useOrgQuery } from '@/api/hooks';
import { Badge, type BadgeTono } from '@/components/Badge';
import { Empty, ErrorNote, Loading, Modal, OkNote, copy } from '@/components/ui';
import { cop } from '@/lib/format';
import { timeAgo } from '@/lib/time';

type Metodo = 'CARD' | 'NEQUI' | 'PSE' | 'BANCOLOMBIA_TRANSFER';
const ETIQUETA: Record<Metodo, string> = { CARD: 'Tarjeta débito y crédito', NEQUI: 'Nequi', PSE: 'PSE', BANCOLOMBIA_TRANSFER: 'Botón Bancolombia' };

type Cuenta =
  | { configured: false; supportedMethods: Metodo[]; simulated: boolean }
  | {
      configured: true;
      id: string;
      environment: 'sandbox' | 'production';
      publicKey: string;
      privateKeyHint: string;
      methods: Metodo[];
      isActive: boolean;
      verifiedAt: string | null;
      lastEventAt: string | null;
      webhookUrl: string;
      supportedMethods: Metodo[];
      simulated: boolean;
    };

interface PagoEnLinea {
  id: string;
  status: 'pending' | 'approved' | 'declined' | 'voided' | 'error';
  method: Metodo;
  amountCop: number;
  message: string | null;
  refundRequired: boolean;
  environment: 'sandbox' | 'production';
  createdAt: string;
  order: { id: string; status: string; raffle: string; numbers: string[] } | null;
  participant: { name: string; phone: string } | null;
}

const ESTADO: Record<PagoEnLinea['status'], { label: string; tono: BadgeTono }> = {
  pending: { label: 'En curso', tono: 'vivo' },
  approved: { label: 'Aprobado', tono: 'abierto' },
  declined: { label: 'Rechazado', tono: 'cerrado' },
  voided: { label: 'Anulado', tono: 'cerrado' },
  error: { label: 'Con error', tono: 'urgente' },
};

function Llaves({ onClose, onDone, actual }: { onClose: () => void; onDone: () => void; actual: Extract<Cuenta, { configured: true }> | null }) {
  const [f, setF] = useState({ publicKey: '', privateKey: '', integritySecret: '', eventsSecret: '' });
  const [metodos, setMetodos] = useState<Metodo[]>(actual?.methods ?? ['CARD', 'NEQUI', 'PSE', 'BANCOLOMBIA_TRANSFER']);
  const conectar = useOrgMutation<void>((_, req) => req('/v1/payments/gateway', { method: 'PUT', body: { ...f, methods: metodos } }));
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value.trim() });
  return (
    <Modal
      title={actual ? 'Reemplazar las llaves de Wompi' : 'Conectar tu cuenta de Wompi'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="rs-btn rs-btn--secundario" onClick={onClose}>Cancelar</button>
          <button type="submit" form="wompi-llaves" className="rs-btn rs-btn--primario" disabled={conectar.isPending || metodos.length === 0}>
            {conectar.isPending ? 'Verificando con Wompi…' : 'Verificar y conectar'}
          </button>
        </>
      }
    >
      <form id="wompi-llaves" className="stack" style={{ gap: 12 }} onSubmit={(e: FormEvent) => { e.preventDefault(); conectar.mutate(undefined, { onSuccess: onDone }); }}>
        <p className="rs-help" style={{ margin: 0 }}>
          En tu cuenta de Wompi entra a <b>Desarrolladores</b> y copia las cuatro llaves del mismo ambiente: las de pruebas (<span className="rs-mono">pub_test_…</span>) o las de producción (<span className="rs-mono">pub_prod_…</span>). El dinero de cada pago llega directo a tu cuenta de Wompi.
        </p>
        <div>
          <label className="rs-label" htmlFor="wk-pub">Llave pública</label>
          <input id="wk-pub" className="rs-in rs-mono" value={f.publicKey} onChange={set('publicKey')} autoComplete="off" required placeholder="pub_test_…" />
        </div>
        <div>
          <label className="rs-label" htmlFor="wk-prv">Llave privada</label>
          <input id="wk-prv" type="password" className="rs-in rs-mono" value={f.privateKey} onChange={set('privateKey')} autoComplete="new-password" required placeholder="prv_test_…" />
          <p className="rs-help">Se guarda cifrada y nunca se vuelve a mostrar.</p>
        </div>
        <div>
          <label className="rs-label" htmlFor="wk-int">Secreto de integridad</label>
          <input id="wk-int" type="password" className="rs-in rs-mono" value={f.integritySecret} onChange={set('integritySecret')} autoComplete="new-password" required placeholder="test_integrity_…" />
        </div>
        <div>
          <label className="rs-label" htmlFor="wk-ev">Secreto de eventos</label>
          <input id="wk-ev" type="password" className="rs-in rs-mono" value={f.eventsSecret} onChange={set('eventsSecret')} autoComplete="new-password" required placeholder="test_events_…" />
        </div>
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="rs-label">Medios de pago</legend>
          {(Object.keys(ETIQUETA) as Metodo[]).map((m) => (
            <label key={m} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '4px 0' }}>
              <input type="checkbox" checked={metodos.includes(m)} onChange={(e) => setMetodos(e.target.checked ? [...metodos, m] : metodos.filter((x) => x !== m))} />
              {ETIQUETA[m]}
            </label>
          ))}
        </fieldset>
        <ErrorNote error={conectar.error} />
      </form>
    </Modal>
  );
}

function Reembolso({ pago, onClose }: { pago: PagoEnLinea; onClose: () => void }) {
  const [nota, setNota] = useState('');
  const marcar = useOrgMutation<void>((_, req) => req(`/v1/payments/gateway/transactions/${pago.id}/refunded`, { body: { note: nota.trim() } }));
  return (
    <Modal
      title="Pago para reembolsar"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="rs-btn rs-btn--secundario" onClick={onClose}>Cerrar</button>
          <button type="button" className="rs-btn rs-btn--primario" disabled={nota.trim().length < 3 || marcar.isPending} onClick={() => marcar.mutate(undefined, { onSuccess: onClose })}>
            Ya lo reembolsé
          </button>
        </>
      }
    >
      <p style={{ marginTop: 0 }}>
        {pago.participant?.name} pagó <b>{cop(pago.amountCop)}</b> y el pago se aprobó, pero {pago.message?.toLowerCase() ?? 'no se pudo aplicar'}.
        Devuélvele el dinero desde tu panel de Wompi y márcalo aquí.
      </p>
      <label className="rs-label" htmlFor="rf-nota">¿Cómo se reembolsó?</label>
      <input id="rf-nota" className="rs-in" value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Reembolso desde Wompi el 3 de nov" />
      <ErrorNote error={marcar.error} style={{ marginTop: 12 }} />
    </Modal>
  );
}

/** Conexión con Wompi y lista de pagos en línea (dentro de Ajustes › Pagos). */
export function PagosEnLinea() {
  const can = useCan();
  const editable = can('settings.brand');
  const cuenta = useOrgQuery<Cuenta>('/v1/payments/gateway');
  const lista = useOrgQuery<{ refundsPending: number; items: PagoEnLinea[] }>(cuenta.data?.configured ? '/v1/payments/gateway/transactions' : null, { refetchInterval: 30_000 });
  const [llaves, setLlaves] = useState(false);
  const [reembolso, setReembolso] = useState<PagoEnLinea | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const actualizar = useOrgMutation<{ methods?: Metodo[]; isActive?: boolean }>((body, req) => req('/v1/payments/gateway', { method: 'PATCH', body }));

  if (!cuenta.data) return cuenta.error ? <ErrorNote error={cuenta.error} /> : <Loading />;
  const c = cuenta.data;

  return (
    <section className="rs-panel setting-panel">
      <h2 className="h2 h2--lg setting-panel__title">Pagos en línea</h2>
      {(ok || actualizar.error) && (
        <div style={{ padding: '0 24px 16px' }} className="stack">
          {ok && <OkNote>{ok}</OkNote>}
          <ErrorNote error={actualizar.error} />
        </div>
      )}
      {!c.configured ? (
        <div style={{ padding: '0 24px 24px', gap: 20 }} className="stack">
          <p style={{ margin: 0 }}>
            Cobra con tarjeta, Nequi, PSE y Botón Bancolombia dentro de tu página de sorteo. El pago se aprueba solo y el participante recibe sus boletos al instante, sin comprobantes que revisar.
          </p>
          <p className="rs-help" style={{ margin: 0 }}>Necesitas una cuenta de Wompi (wompi.com). El dinero llega directo a tu cuenta; Rifa Star no lo toca.</p>
          {c.simulated && <p className="note note--fondo" style={{ margin: 0 }}>Pasarela simulada: sirve para probar el flujo; no se mueve dinero.</p>}
          {editable && <div><button type="button" className="rs-btn rs-btn--primario" onClick={() => setLlaves(true)}>Conectar Wompi</button></div>}
        </div>
      ) : (
        <div style={{ padding: '0 24px 24px', gap: 20 }} className="stack">
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <Badge tono={c.isActive ? 'abierto' : 'cerrado'}>{c.isActive ? 'Activo' : 'En pausa'}</Badge>
            <Badge tono={c.environment === 'production' ? 'ganador' : 'vivo'}>{c.environment === 'production' ? 'Producción' : 'Modo de pruebas'}</Badge>
            {c.simulated && <Badge tono="cerrado">Simulado</Badge>}
            <span className="cell-sub">Llave pública <span className="rs-mono">{c.publicKey}</span> · privada <span className="rs-mono">{c.privateKeyHint}</span></span>
          </div>
          {c.environment === 'sandbox' && !c.simulated && <p className="note note--fondo" style={{ margin: 0 }}>Estás con llaves de pruebas: los pagos no mueven dinero real. Cuando termines de probar, reemplázalas por las de producción.</p>}

          <div>
            <div className="setting__t">URL de eventos</div>
            <p className="setting__d" style={{ margin: '2px 0 8px' }}>
              Pégala en Wompi › Desarrolladores › <b>URL de eventos</b>. Así Wompi nos avisa apenas se aprueba un pago.
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <input className="rs-in rs-mono" readOnly aria-label="URL de eventos" value={c.webhookUrl} style={{ flex: 1 }} onFocus={(e) => e.currentTarget.select()} />
              <button type="button" className="rs-btn rs-btn--secundario" onClick={() => copy(c.webhookUrl).then(() => setOk('URL copiada.'))}>Copiar</button>
            </div>
            <p className="rs-help" style={{ marginTop: 6 }}>
              {c.lastEventAt ? `Último evento recibido ${timeAgo(c.lastEventAt)}.` : 'Todavía no hemos recibido ningún evento de Wompi. Sin la URL los pagos igual se confirman, pero con unos minutos de retraso.'}
            </p>
          </div>

          <fieldset style={{ border: 0, padding: 0, margin: 0 }} disabled={!editable || actualizar.isPending}>
            <legend className="setting__t">Medios de pago</legend>
            {(Object.keys(ETIQUETA) as Metodo[]).map((m) => (
              <label key={m} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '4px 0' }}>
                <input
                  type="checkbox"
                  checked={c.methods.includes(m)}
                  onChange={(e) => {
                    const next = e.target.checked ? [...c.methods, m] : c.methods.filter((x) => x !== m);
                    if (next.length > 0) actualizar.mutate({ methods: next });
                  }}
                />
                {ETIQUETA[m]}
              </label>
            ))}
          </fieldset>

          {editable && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" className="rs-btn rs-btn--secundario rs-btn--sm" disabled={actualizar.isPending} onClick={() => actualizar.mutate({ isActive: !c.isActive })}>
                {c.isActive ? 'Pausar pagos en línea' : 'Reactivar'}
              </button>
              <button type="button" className="rs-btn rs-btn--fantasma rs-btn--sm" onClick={() => setLlaves(true)}>Reemplazar llaves</button>
            </div>
          )}

          {lista.data && lista.data.refundsPending > 0 && (
            <div className="note note--alerta" role="alert">
              <span>Tienes {lista.data.refundsPending} pago{lista.data.refundsPending > 1 ? 's' : ''} aprobado{lista.data.refundsPending > 1 ? 's' : ''} que no se pudo{lista.data.refundsPending > 1 ? 'ieron' : ''} aplicar: hay que devolver el dinero.</span>
            </div>
          )}
          <div>
            <div className="setting__t">Últimos pagos en línea</div>
            {lista.isLoading && <Loading />}
            {lista.data && lista.data.items.length === 0 && <Empty>Todavía no hay pagos en línea.</Empty>}
            {lista.data && lista.data.items.length > 0 && (
              <div className="table-scroll">
                <table className="rs-tabla">
                  <thead><tr><th>Cuándo</th><th>Participante</th><th>Medio</th><th>Valor</th><th>Estado</th></tr></thead>
                  <tbody>
                    {lista.data.items.map((p) => (
                      <tr key={p.id}>
                        <td className="cell-sub">{timeAgo(p.createdAt)}</td>
                        <td>{p.participant?.name ?? '—'}<br /><span className="cell-sub">{p.order?.numbers.join(', ')}</span></td>
                        <td>{ETIQUETA[p.method]}</td>
                        <td className="td-mono">{cop(p.amountCop)}</td>
                        <td>
                          <Badge tono={ESTADO[p.status].tono}>{ESTADO[p.status].label}</Badge>
                          {p.refundRequired && (
                            <button type="button" className="rs-btn rs-btn--urgente rs-btn--sm" style={{ marginLeft: 8 }} onClick={() => setReembolso(p)}>Reembolsar</button>
                          )}
                          {p.status !== 'approved' && p.message && !p.refundRequired && <><br /><span className="cell-sub">{p.message}</span></>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
      {llaves && <Llaves actual={c.configured ? c : null} onClose={() => setLlaves(false)} onDone={() => { setLlaves(false); setOk('Cuenta de Wompi conectada. Copia la URL de eventos en Wompi para terminar.'); }} />}
      {reembolso && <Reembolso pago={reembolso} onClose={() => setReembolso(null)} />}
    </section>
  );
}
