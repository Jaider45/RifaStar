import { useEffect, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useOrgMutation, useOrgQuery } from '@/api/hooks';
import { Badge } from '@/components/Badge';
import { ErrorNote, Loading, Modal, OkNote } from '@/components/ui';
import { cop } from '@/lib/format';
import { formatDay } from '@/lib/time';
import { CardError, tokenizeCard } from '@/lib/wompi';

interface CardConfig {
  environment: 'sandbox' | 'production';
  publicKey: string;
  tokenizeUrl: string;
  plan: { code: string; name: string };
  amountCop: number;
  contracts: { terms: string; personalData: string };
}

interface PagoPlan {
  status: 'pending' | 'approved' | 'declined' | 'voided' | 'error';
  message: string | null;
  final: boolean;
}

export interface TarjetaGuardada {
  brand: string | null;
  lastFour: string | null;
  expMonth: string | null;
  expYear: string | null;
}

/** Formulario de tarjeta: la tokeniza en el navegador y solo entrega el token a quien lo usa. */
function FormularioTarjeta({ cfg, id, onToken, onError }: { cfg: CardConfig; id: string; onToken: (token: string) => void; onError: (e: unknown) => void }) {
  const [t, setT] = useState({ number: '', holder: '', exp: '', cvc: '' });
  const [terminos, setTerminos] = useState(false);
  const [datos, setDatos] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!terminos || !datos) return onError(new Error('Acepta los dos contratos para continuar.'));
    try {
      const [mm, aa] = t.exp.split('/').map((s) => s.trim());
      onToken(
        await tokenizeCard({ tokenizeUrl: cfg.tokenizeUrl, publicKey: cfg.publicKey, card: { number: t.number, holder: t.holder, cvc: t.cvc, expMonth: mm ?? '', expYear: aa ?? '' } }),
      );
    } catch (err) {
      onError(err instanceof CardError ? new Error(err.message) : err);
    }
  };
  return (
    <form id={id} className="stack" style={{ gap: 12 }} onSubmit={submit}>
      <div>
        <label className="rs-label" htmlFor={`${id}-num`}>Número de la tarjeta</label>
        <input id={`${id}-num`} className="rs-in rs-mono" inputMode="numeric" autoComplete="cc-number" value={t.number} onChange={(e) => setT({ ...t, number: e.target.value.replace(/[^\d ]/g, '').slice(0, 23) })} placeholder="1234 5678 9012 3456" required />
      </div>
      <div>
        <label className="rs-label" htmlFor={`${id}-nom`}>Nombre en la tarjeta</label>
        <input id={`${id}-nom`} className="rs-in" autoComplete="cc-name" value={t.holder} onChange={(e) => setT({ ...t, holder: e.target.value })} required />
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ flex: 1 }}>
          <label className="rs-label" htmlFor={`${id}-exp`}>Vence (MM/AA)</label>
          <input id={`${id}-exp`} className="rs-in rs-mono" inputMode="numeric" autoComplete="cc-exp" maxLength={7} placeholder="MM/AA" value={t.exp} onChange={(e) => setT({ ...t, exp: e.target.value.replace(/[^\d/]/g, '') })} required />
        </div>
        <div style={{ flex: 1 }}>
          <label className="rs-label" htmlFor={`${id}-cvc`}>Código (CVC)</label>
          <input id={`${id}-cvc`} className="rs-in rs-mono" inputMode="numeric" autoComplete="cc-csc" maxLength={4} value={t.cvc} onChange={(e) => setT({ ...t, cvc: e.target.value.replace(/\D/g, '') })} required />
        </div>
      </div>
      <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', font: '500 13px/18px var(--font-sans)' }}>
        <input type="checkbox" checked={terminos} onChange={(e) => setTerminos(e.target.checked)} style={{ marginTop: 2 }} />
        <span>Acepto los <a href={cfg.contracts.terms} target="_blank" rel="noreferrer" className="strong-link">términos y condiciones</a> del procesador de pagos.</span>
      </label>
      <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', font: '500 13px/18px var(--font-sans)' }}>
        <input type="checkbox" checked={datos} onChange={(e) => setDatos(e.target.checked)} style={{ marginTop: 2 }} />
        <span>Autorizo el <a href={cfg.contracts.personalData} target="_blank" rel="noreferrer" className="strong-link">tratamiento de mis datos personales</a>.</span>
      </label>
      {cfg.environment === 'sandbox' && <p className="note note--fondo" style={{ margin: 0 }}>Modo de pruebas: no se hace ningún cobro real.</p>}
      <p className="rs-help" style={{ margin: 0 }}>Los datos de tu tarjeta van cifrados al procesador de pagos y no se guardan en Rifa Star.</p>
    </form>
  );
}

/** Contratar o cambiar de plan con tarjeta. Se cobra el primer mes y el plan se renueva solo cada mes. */
export function ContratarPlan({ plan, onClose }: { plan: { code: string; name: string; monthlyPriceCop: number }; onClose: () => void }) {
  const qc = useQueryClient();
  const cfg = useOrgQuery<CardConfig>(`/v1/billing/card-checkout?planCode=${plan.code}`, { staleTime: 0 });
  const [error, setError] = useState<unknown>(null);
  const [esperando, setEsperando] = useState(false);
  const suscribir = useOrgMutation<string, { payment: PagoPlan }>((cardToken, req) =>
    req('/v1/billing/subscribe', { body: { planCode: plan.code, cardToken, acceptTerms: true, acceptPersonalData: true } }),
  );
  const estado = useOrgQuery<{ payment: PagoPlan | null }>(esperando ? '/v1/billing/subscribe/status' : null, { refetchInterval: 2_500, staleTime: 0 });
  const pago = estado.data?.payment ?? suscribir.data?.payment ?? null;
  const aprobado = pago?.status === 'approved';
  const fallo = esperando && pago?.final && !aprobado;

  useEffect(() => {
    if (aprobado) void qc.invalidateQueries({ queryKey: ['org'] });
  }, [aprobado, qc]);

  return (
    <Modal
      title={`Contratar plan ${plan.name}`}
      onClose={onClose}
      footer={
        aprobado ? (
          <button type="button" className="rs-btn rs-btn--primario" onClick={onClose}>Listo</button>
        ) : (
          <>
            <button type="button" className="rs-btn rs-btn--secundario" onClick={onClose}>Cancelar</button>
            {(!esperando || fallo) && (
              <button type="submit" form="plan-tarjeta" className="rs-btn rs-btn--primario" disabled={!cfg.data || suscribir.isPending}>
                {suscribir.isPending ? 'Procesando…' : `Pagar ${cop(plan.monthlyPriceCop)}`}
              </button>
            )}
          </>
        )
      }
    >
      {aprobado ? (
        <OkNote>¡Listo! Tu plan {plan.name} ya está activo. Se renueva solo cada mes y puedes cancelarlo cuando quieras.</OkNote>
      ) : esperando && !fallo ? (
        <Loading label="Confirmando tu pago con el banco…" />
      ) : (
        <>
          <p style={{ marginTop: 0 }}>
            Pagas <b>{cop(plan.monthlyPriceCop)}</b> hoy y se cobra la misma tarjeta cada mes. Si ya tenías otro plan, este lo reemplaza desde hoy.
          </p>
          {fallo && (
            <div className="note note--alerta" role="alert" style={{ marginBottom: 12 }}>
              <span>{pago?.message ? `${pago.message}. ` : ''}No se hizo ningún cobro. Prueba con otra tarjeta.</span>
            </div>
          )}
          {!cfg.data ? (
            cfg.error ? <ErrorNote error={cfg.error} /> : <Loading />
          ) : (
            <FormularioTarjeta
              id="plan-tarjeta"
              cfg={cfg.data}
              onError={setError}
              onToken={(token) => {
                setError(null);
                suscribir.mutate(token, { onSuccess: () => setEsperando(true), onError: setError });
              }}
            />
          )}
          <ErrorNote error={error} style={{ marginTop: 12 }} />
        </>
      )}
    </Modal>
  );
}

function CambiarTarjeta({ planCode, onClose }: { planCode: string; onClose: () => void }) {
  const cfg = useOrgQuery<CardConfig>(`/v1/billing/card-checkout?planCode=${planCode}`, { staleTime: 0 });
  const [error, setError] = useState<unknown>(null);
  const [listo, setListo] = useState<string | null>(null);
  const cambiar = useOrgMutation<string, { card: TarjetaGuardada; retry: PagoPlan | null }>((cardToken, req) =>
    req('/v1/billing/card', { body: { cardToken, acceptTerms: true, acceptPersonalData: true } }),
  );
  return (
    <Modal
      title="Cambiar tarjeta"
      onClose={onClose}
      footer={
        listo ? (
          <button type="button" className="rs-btn rs-btn--primario" onClick={onClose}>Listo</button>
        ) : (
          <>
            <button type="button" className="rs-btn rs-btn--secundario" onClick={onClose}>Cancelar</button>
            <button type="submit" form="cambiar-tarjeta" className="rs-btn rs-btn--primario" disabled={!cfg.data || cambiar.isPending}>{cambiar.isPending ? 'Guardando…' : 'Guardar tarjeta'}</button>
          </>
        )
      }
    >
      {listo ? (
        <OkNote>{listo}</OkNote>
      ) : !cfg.data ? (
        cfg.error ? <ErrorNote error={cfg.error} /> : <Loading />
      ) : (
        <>
          <p style={{ marginTop: 0 }}>La nueva tarjeta se usará en las próximas renovaciones. Si tu pago estaba vencido, lo intentamos cobrar de inmediato.</p>
          <FormularioTarjeta
            id="cambiar-tarjeta"
            cfg={cfg.data}
            onError={setError}
            onToken={(token) => {
              setError(null);
              cambiar.mutate(token, {
                onSuccess: (r) => setListo(r.retry ? 'Tarjeta guardada. Estamos cobrando tu plan pendiente; en unos segundos verás el resultado.' : 'Tarjeta guardada.'),
                onError: setError,
              });
            }}
          />
          <ErrorNote error={error} style={{ marginTop: 12 }} />
        </>
      )}
    </Modal>
  );
}

/** Tarjeta de renovación y cancelación del plan (solo con cobro en el checkout propio). */
export function TarjetaPlan({
  planCode,
  card,
  cancelAtPeriodEnd,
  currentPeriodEnd,
  tz,
}: {
  planCode: string;
  card: TarjetaGuardada | null;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
  tz?: string;
}) {
  const [cambiar, setCambiar] = useState(false);
  const [confirmar, setConfirmar] = useState(false);
  const cancelar = useOrgMutation<boolean>((cancel, req) => req(cancel ? '/v1/billing/cancel' : '/v1/billing/resume', { method: 'POST' }));
  return (
    <div className="stack" style={{ gap: 12, borderTop: '1px solid var(--linea)', paddingTop: 16 }}>
      <div className="setting__t">Método de pago</div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <span>
          {card ? (
            <>
              <b>{card.brand ?? 'Tarjeta'}</b> terminada en <span className="rs-mono">{card.lastFour}</span>
              {card.expMonth && card.expYear ? <span className="cell-sub"> · vence {card.expMonth.padStart(2, '0')}/{card.expYear.slice(-2)}</span> : null}
            </>
          ) : (
            'Sin tarjeta guardada'
          )}
        </span>
        <button type="button" className="rs-btn rs-btn--secundario rs-btn--sm" onClick={() => setCambiar(true)}>Cambiar tarjeta</button>
      </div>
      <ErrorNote error={cancelar.error} />
      {cancelAtPeriodEnd ? (
        <div className="note note--alerta" role="status" style={{ flexWrap: 'wrap' }}>
          <span>Tu plan se cancela el {currentPeriodEnd ? formatDay(currentPeriodEnd, tz) : 'al final del periodo'}. Hasta entonces sigue activo.</span>
          <button type="button" className="rs-btn rs-btn--secundario rs-btn--sm" disabled={cancelar.isPending} onClick={() => cancelar.mutate(false)}>Mantener mi plan</button>
        </div>
      ) : (
        <div>
          <button type="button" className="rs-btn rs-btn--fantasma rs-btn--sm" style={{ color: 'var(--rojo-texto)' }} onClick={() => setConfirmar(true)}>Cancelar plan</button>
        </div>
      )}
      {cambiar && <CambiarTarjeta planCode={planCode} onClose={() => setCambiar(false)} />}
      {confirmar && (
        <Modal
          title="Cancelar plan"
          onClose={() => setConfirmar(false)}
          footer={
            <>
              <button type="button" className="rs-btn rs-btn--secundario" onClick={() => setConfirmar(false)}>Mantener mi plan</button>
              <button type="button" className="rs-btn rs-btn--urgente" disabled={cancelar.isPending} onClick={() => cancelar.mutate(true, { onSuccess: () => setConfirmar(false) })}>Cancelar al final del periodo</button>
            </>
          }
        >
          <p style={{ margin: 0 }}>
            No se te vuelve a cobrar. Tu plan sigue activo hasta el {currentPeriodEnd ? formatDay(currentPeriodEnd, tz) : 'final del periodo pagado'} y después la cuenta se pausa. Puedes volver a contratar cuando quieras. <Badge tono="cerrado">Sin reembolso parcial</Badge>
          </p>
        </Modal>
      )}
    </div>
  );
}
