import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useCan, useOrgMutation, useOrgProfile, useOrgQuery } from '@/api/hooks';
import type { Order, PaymentAccount, Raffle } from '@/api/types';
import { Icon } from '@/components/Icon';
import { PageHeader } from '@/components/PageHeader';
import { Empty, ErrorNote, Loading, Modal } from '@/components/ui';
import { cop } from '@/lib/format';
import { formatPhone, waLink } from '@/lib/phone';
import { formatTime, timeAgo } from '@/lib/time';
import './Pagos.css';

export default function Pagos() {
  const can = useCan();
  const { data: org } = useOrgProfile();
  const [params, setParams] = useSearchParams();
  const sorteo = params.get('sorteo') ?? '';
  const raffles = useOrgQuery<Raffle[]>('/v1/raffles');
  const queue = useOrgQuery<Order[]>(`/v1/payments/queue${sorteo ? `?raffleId=${sorteo}` : ''}`, { refetchInterval: 20_000 });
  const accounts = useOrgQuery<PaymentAccount[]>('/v1/payment-accounts');
  const [actual, setActual] = useState<string | null>(null);
  const [rechazar, setRechazar] = useState(false);
  const [ampliar, setAmpliar] = useState(false);

  const pendientes = queue.data ?? [];
  const selId = pendientes.some((p) => p.id === actual) ? actual : (pendientes[0]?.id ?? null);
  const detalle = useOrgQuery<Order>(selId ? `/v1/orders/${selId}` : null);
  const sel = detalle.data;
  useEffect(() => setAmpliar(false), [selId]);

  const siguiente = () => {
    const resto = pendientes.filter((p) => p.id !== selId);
    setActual(resto[0]?.id ?? null);
  };
  const aprobar = useOrgMutation<string>((id, req) => req(`/v1/orders/${id}/approve`, { method: 'POST' }).then(() => undefined));
  const rechazo = useOrgMutation<{ id: string; reason: string }>(({ id, reason }, req) =>
    req(`/v1/orders/${id}/reject`, { body: { reason } }).then(() => undefined),
  );
  const vivos = (raffles.data ?? []).filter((r) => ['active', 'sold_out', 'closed'].includes(r.status));
  const esPdf = sel?.receipt?.mime === 'application/pdf';

  return (
    <>
      <PageHeader
        title="Verificar pagos"
        sub="Compara el comprobante con tu cuenta y aprueba. El participante recibe su boleto por WhatsApp al instante."
        actions={
          <label className="pagos-sorteo">
            <span className="rs-label">Sorteo</span>
            <select
              className="rs-in"
              value={sorteo}
              onChange={(e) => {
                setActual(null);
                setParams(e.target.value ? { sorteo: e.target.value } : {});
              }}
            >
              <option value="">Todos los sorteos</option>
              {vivos.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
            </select>
          </label>
        }
      />

      <ErrorNote error={queue.error ?? aprobar.error ?? rechazo.error} />

      <div className="split">
        <section aria-label="Pagos pendientes" className="rs-panel pagos-lista">
          <div className="pagos-lista__head">
            <span className="pagos-lista__titulo">Pendientes · {pendientes.length}</span>
            <span className="pagos-lista__orden">Más antiguos primero</span>
          </div>
          {queue.isLoading && <Loading />}
          {!queue.isLoading && pendientes.length === 0 && <div className="pagos-vacio">No hay pagos por verificar.</div>}
          {pendientes.map((p) => (
            <button key={p.id} type="button" className="pago-item" aria-pressed={p.id === selId} onClick={() => setActual(p.id)}>
              <div className="pago-item__info">
                <div className="pago-item__nombre">{p.participant.name}</div>
                <div className="pago-item__meta">
                  {p.numbers.length === 1 ? 'Número' : 'Números'} {p.numbers.join(', ')} · {timeAgo(p.receipt?.uploadedAt ?? p.createdAt)}
                </div>
              </div>
              <span className="rs-mono pago-item__monto">{cop(p.totalCop)}</span>
            </button>
          ))}
        </section>

        <section aria-label="Detalle del pago" className="rs-panel pago-detalle">
          {!selId ? (
            <Empty>Cuando llegue un pago aparecerá aquí.</Empty>
          ) : !sel ? (
            <Loading />
          ) : (
            <>
              <div className="rs-foto pago-detalle__captura" style={sel.receiptUrl && !esPdf ? { padding: 0, overflow: 'hidden' } : undefined}>
                {sel.receiptUrl && !esPdf ? (
                  <img src={sel.receiptUrl} alt={`Comprobante de ${sel.participant.name}`} style={{ width: '100%', height: '100%', objectFit: 'contain', cursor: 'zoom-in' }} onClick={() => setAmpliar(true)} />
                ) : (
                  <>
                    <Icon name="receipt" size={28} strokeWidth={1.8} />
                    {sel.receiptUrl ? 'Comprobante en PDF' : 'El participante reportó el pago sin comprobante'}
                    {sel.receiptUrl && (
                      <a href={sel.receiptUrl} target="_blank" rel="noreferrer" className="rs-btn rs-btn--secundario rs-btn--sm">Abrir PDF</a>
                    )}
                  </>
                )}
              </div>
              <div className="pago-detalle__datos">
                <div>
                  <div className="pago-detalle__label">Participante</div>
                  <div className="rs-display pago-detalle__nombre">{sel.participant.name}</div>
                  {sel.participant.phone.startsWith('+') ? (
                    <a href={waLink(sel.participant.phone)} className="strong-link" target="_blank" rel="noreferrer">{formatPhone(sel.participant.phone)}</a>
                  ) : (
                    <span className="cell-sub">{sel.participant.phone}</span>
                  )}
                </div>
                <div className="chips">
                  {sel.numbers.map((n) => <span key={n} className="rs-mono pago-detalle__num">{n}</span>)}
                </div>
                <dl className="pago-detalle__dl">
                  <dt>Debe pagar</dt>
                  <dd className="rs-mono" style={{ fontWeight: 700 }}>{cop(sel.totalCop)}</dd>
                  <dt>Sorteo</dt>
                  <dd>{sel.raffle.title}</dd>
                  <dt>Medios</dt>
                  <dd>{(accounts.data ?? []).map((a) => `${a.typeLabel} · ${a.keyOrNumber}`).join(' / ') || '—'}</dd>
                  <dt>Enviado</dt>
                  <dd>{timeAgo(sel.receipt?.uploadedAt ?? sel.createdAt)}</dd>
                  {sel.sellerCode && (
                    <>
                      <dt>Vendedor</dt>
                      <dd className="rs-mono">{sel.sellerCode}</dd>
                    </>
                  )}
                  {sel.status === 'reserved' && (
                    <>
                      <dt>Apartado hasta</dt>
                      <dd>{formatTime(sel.reservedUntil, org?.timezone)}</dd>
                    </>
                  )}
                </dl>
                <div className="note note--ok">Revisa que el valor y la hora coincidan con el movimiento en tu cuenta.</div>
                {can('payments.approve') && (
                  <div className="pago-detalle__acciones">
                    <button
                      type="button"
                      className="rs-btn rs-btn--primario"
                      style={{ flex: '1 1 160px' }}
                      disabled={aprobar.isPending}
                      onClick={() => aprobar.mutateAsync(sel.id).then(siguiente).catch(() => undefined)}
                    >
                      <Icon name="check" size={18} strokeWidth={2.6} />
                      {aprobar.isPending ? 'Aprobando…' : 'Aprobar pago'}
                    </button>
                    <button
                      type="button"
                      className="rs-btn rs-btn--secundario"
                      style={{ flex: '1 1 120px', color: 'var(--rojo-texto)' }}
                      onClick={() => setRechazar(true)}
                    >
                      Rechazar
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </section>
      </div>

      {rechazar && sel && (
        <MotivoRechazo
          nombre={sel.participant.name}
          onClose={() => setRechazar(false)}
          onConfirm={(reason) =>
            rechazo
              .mutateAsync({ id: sel.id, reason })
              .then(() => {
                setRechazar(false);
                siguiente();
              })
              .catch(() => setRechazar(false))
          }
        />
      )}
      {ampliar && sel?.receiptUrl && (
        <Modal title={`Comprobante de ${sel.participant.name}`} onClose={() => setAmpliar(false)}>
          <img src={sel.receiptUrl} alt="Comprobante ampliado" style={{ width: '100%', borderRadius: 12 }} />
        </Modal>
      )}
    </>
  );
}

const MOTIVOS = ['El valor no coincide', 'No vemos el pago en la cuenta', 'El comprobante no se lee', 'El comprobante es de otra persona o fecha'];

function MotivoRechazo({ nombre, onClose, onConfirm }: { nombre: string; onClose: () => void; onConfirm: (reason: string) => void }) {
  const [reason, setReason] = useState(MOTIVOS[0]);
  return (
    <Modal
      title={`Rechazar el pago de ${nombre}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="rs-btn rs-btn--secundario" onClick={onClose}>Volver</button>
          <button type="button" className="rs-btn rs-btn--urgente" disabled={reason.trim().length < 3} onClick={() => onConfirm(reason.trim())}>
            Rechazar y liberar números
          </button>
        </>
      }
    >
      <p className="rs-help">Los números quedan libres y el participante recibe el motivo por WhatsApp.</p>
      <div className="chips">
        {MOTIVOS.map((m) => (
          <button key={m} type="button" className="rs-chip" aria-pressed={reason === m} onClick={() => setReason(m)}>{m}</button>
        ))}
      </div>
      <div>
        <label className="rs-label" htmlFor="motivo">Motivo</label>
        <input id="motivo" className="rs-in" value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
    </Modal>
  );
}
