import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useCan, useOrgMutation, useOrgPages, useOrgQuery } from '@/api/hooks';
import { PageHeader } from '@/components/PageHeader';
import { Empty, ErrorNote, Loading, Modal } from '@/components/ui';
import { cop } from '@/lib/format';
import { formatDay, formatTime } from '@/lib/time';
import './Comprobantes.css';

interface Eligible {
  orderId: string;
  customer: string;
  raffle: string;
  quantity: number;
  totalCop: number;
  paidAt: string;
}
interface Issued {
  id: string;
  sequence: number;
  customer: string;
  raffle: string;
  raffleCancelled: boolean;
  issuedAt: string;
  totalCop: number;
  quantity: number;
  voidedAt: string | null;
}
interface IncomeReceipt {
  id: string;
  sequence: number;
  issuedAt: string;
  voidedAt: string | null;
  voidReason: string | null;
  raffleCancelled: boolean;
  snapshot: {
    issuer: { name: string; taxId: string; address: string; phone: string; email: string; logoUrl: string | null; accentColor: string };
    customer: { name: string; phone: string };
    purchase: { concept: string; raffle: string; quantity: number; unitLabel: string; unitPriceCop: number; totalCop: number; numbers: string[] };
    issuedAt: string;
    paidAt: string;
    footer: string;
    disclaimer: string;
  };
}

const receiptNumber = (n: number) => `CI-${String(n).padStart(6, '0')}`;
const printNumbers = (numbers: string[]) => numbers.length > 300
  ? `${numbers.slice(0, 100).join(' · ')} · y ${numbers.length - 100} más (listado abreviado)`
  : numbers.join(' · ');

export default function Comprobantes() {
  const { id } = useParams();
  const can = useCan();
  const navigate = useNavigate();
  const detail = useOrgQuery<IncomeReceipt>(id ? `/v1/receipts/${id}` : null);
  const eligible = useOrgPages<Eligible, { items: Eligible[]; nextCursor: string | null }>(id ? null : '/v1/receipts/eligible');
  const issued = useOrgPages<Issued, { items: Issued[]; nextCursor: string | null; vigentesCancelados: number }>(id ? null : '/v1/receipts');
  const issue = useOrgMutation<string, IncomeReceipt>((orderId, req) => req(`/v1/receipts/orders/${orderId}`, { method: 'POST' }));
  const [anular, setAnular] = useState<{ id: string; numero: string; cancelado: boolean } | null>(null);
  const puedeAnular = can('payments.release');
  const vigentesCancelados = issued.first?.vigentesCancelados ?? 0;

  if (!can('receipts.issue')) return <ErrorNote error={new Error('No tienes permiso para emitir comprobantes.')} />;
  if (id) return <ReceiptView receipt={detail.data} loading={!detail.data && !detail.error} error={detail.error} puedeAnular={puedeAnular} />;

  return (
    <>
      <PageHeader title="Comprobantes de ingreso" sub="Emite un comprobante cuando verifiques un pago. Cada compra aprobada puede tener un comprobante numerado." actions={<button type="button" className="rs-btn rs-btn--secundario" onClick={() => navigate('/admin/ajustes?tab=comprobantes')}>Personalizar comprobante</button>} />
      <ErrorNote error={eligible.error ?? issued.error ?? issue.error} />
      {vigentesCancelados > 0 && (
        <div className="note note--alerta" role="status">
          {vigentesCancelados === 1
            ? 'Tienes 1 comprobante vigente de un sorteo cancelado. Si devolviste el dinero, anúlalo; si no, puedes dejarlo así.'
            : `Tienes ${vigentesCancelados} comprobantes vigentes de sorteos cancelados. Si devolviste el dinero, anúlalos; si no, puedes dejarlos así.`}
        </div>
      )}
      <section className="rs-panel panel-pad ci-section">
        <div>
          <h2 className="h2 h2--lg">Compras sin comprobante</h2>
          <p className="muted">Solo aparecen compras con pago aprobado.</p>
        </div>
        {!eligible.items ? <Loading /> : eligible.items.length === 0 ? <Empty>Todas las compras aprobadas ya tienen comprobante.</Empty> : (
          <div className="table-scroll"><table className="rs-tabla">
            <thead><tr><th>Cliente</th><th>Sorteo</th><th>Boletos</th><th>Total recibido</th><th>Pago aprobado</th><th /></tr></thead>
            <tbody>{eligible.items.map((row) => (
              <tr key={row.orderId}>
                <td>{row.customer}</td><td>{row.raffle}</td><td>{row.quantity.toLocaleString('es-CO')}</td>
                <td className="td-mono">{cop(row.totalCop)}</td><td>{formatDay(row.paidAt)} · {formatTime(row.paidAt)}</td>
                <td><button type="button" className="rs-btn rs-btn--primario rs-btn--sm" disabled={issue.isPending} onClick={() => issue.mutateAsync(row.orderId).then((receipt) => navigate(`/admin/comprobantes/${receipt.id}`)).catch(() => undefined)}>{issue.isPending ? 'Generando…' : 'Generar'}</button></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
        <CargarMas pages={eligible} />
      </section>

      <section className="rs-panel panel-pad ci-section">
        <div><h2 className="h2 h2--lg">Emitidos</h2><p className="muted">Los comprobantes emitidos conservan los datos y el concepto originales.</p></div>
        {!issued.items ? <Loading /> : issued.items.length === 0 ? <Empty>Aún no has emitido comprobantes.</Empty> : (
          <div className="table-scroll"><table className="rs-tabla">
            <thead><tr><th>Número</th><th>Cliente</th><th>Boletos</th><th>Ingreso</th><th>Fecha de emisión</th><th>Estado</th><th /></tr></thead>
            <tbody>{issued.items.map((row) => (
              <tr key={row.id}>
                <td className="td-mono">{receiptNumber(row.sequence)}</td><td>{row.customer}</td><td>{row.quantity}</td><td className="td-mono">{cop(row.totalCop)}</td><td>{formatDay(row.issuedAt)}</td>
                <td>
                  {row.voidedAt ? <span className="ci-state ci-state--void">Anulado</span> : <span className="ci-state">Vigente</span>}
                  {row.raffleCancelled && <div className="cell-sub">Sorteo cancelado</div>}
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button type="button" className="rs-btn rs-btn--secundario rs-btn--sm" onClick={() => navigate(`/admin/comprobantes/${row.id}`)}>Abrir</button>
                  {!row.voidedAt && puedeAnular && (
                    <button type="button" className="rs-btn rs-btn--fantasma rs-btn--sm" style={{ color: 'var(--rojo-texto)' }} onClick={() => setAnular({ id: row.id, numero: receiptNumber(row.sequence), cancelado: row.raffleCancelled })}>
                      Anular
                    </button>
                  )}
                </td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
        <CargarMas pages={issued} />
      </section>
      {anular && <AnularComprobante {...anular} onClose={() => setAnular(null)} />}
    </>
  );
}

function CargarMas({ pages }: { pages: { hasNextPage: boolean; isFetchingNextPage: boolean; fetchNextPage: () => unknown } }) {
  if (!pages.hasNextPage) return null;
  return (
    <button type="button" className="rs-btn rs-btn--secundario rs-btn--sm" style={{ alignSelf: 'center' }} disabled={pages.isFetchingNextPage} onClick={() => pages.fetchNextPage()}>
      {pages.isFetchingNextPage ? 'Cargando…' : 'Cargar más'}
    </button>
  );
}

/** Anular a mano: el comprobante no se borra, queda marcado como anulado con el motivo. */
function AnularComprobante({ id, numero, cancelado, onClose }: { id: string; numero: string; cancelado: boolean; onClose: () => void }) {
  const [reason, setReason] = useState(cancelado ? 'Sorteo cancelado: dinero devuelto' : '');
  const anular = useOrgMutation<void>((_v, req) => req(`/v1/receipts/${id}/void`, { body: { reason: reason.trim() } }).then(() => undefined));
  return (
    <Modal
      title={`Anular ${numero}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="rs-btn rs-btn--secundario" onClick={onClose}>Dejarlo vigente</button>
          <button type="button" className="rs-btn rs-btn--urgente" disabled={anular.isPending || reason.trim().length < 3} onClick={() => anular.mutateAsync().then(onClose).catch(() => undefined)}>
            {anular.isPending ? 'Anulando…' : 'Anular comprobante'}
          </button>
        </>
      }
    >
      <p className="rs-help">El comprobante no se borra: queda marcado como anulado con el motivo y no se puede deshacer.</p>
      <ErrorNote error={anular.error} />
      <div>
        <label className="rs-label" htmlFor="motivo-anular">Motivo</label>
        <input id="motivo-anular" className="rs-in" value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
    </Modal>
  );
}

function ReceiptView({ receipt, loading, error, puedeAnular }: { receipt?: IncomeReceipt; loading: boolean; error: unknown; puedeAnular: boolean }) {
  const navigate = useNavigate();
  const [anular, setAnular] = useState(false);
  if (loading) return <Loading />;
  if (error || !receipt) return <><PageHeader title="Comprobante" crumb={{ to: '/admin/comprobantes', label: 'Volver a comprobantes' }} /><ErrorNote error={error ?? new Error('No encontramos el comprobante.')} /></>;
  const { issuer, customer, purchase } = receipt.snapshot;
  return (
    <div className="ci-print-shell">
      <div className="ci-toolbar"><button type="button" className="rs-btn rs-btn--secundario" onClick={() => navigate('/admin/comprobantes')}>Volver</button>{!receipt.voidedAt && puedeAnular && <button type="button" className="rs-btn rs-btn--fantasma" style={{ color: 'var(--rojo-texto)' }} onClick={() => setAnular(true)}>Anular</button>}<button type="button" className="rs-btn rs-btn--primario" onClick={() => window.print()}>Imprimir o guardar PDF</button></div>
      {anular && <AnularComprobante id={receipt.id} numero={receiptNumber(receipt.sequence)} cancelado={receipt.raffleCancelled} onClose={() => setAnular(false)} />}
      <article className="ci-paper" style={{ '--ci-accent': issuer.accentColor } as React.CSSProperties}>
        <header className="ci-head">
          <div className="ci-brand">{issuer.logoUrl && <img src={issuer.logoUrl} alt="" />}<div><h1>{issuer.name}</h1><p>Comprobante de ingreso</p></div></div>
          <div className="ci-number"><span>N.º de comprobante</span><strong>{receiptNumber(receipt.sequence)}</strong><small>{formatDay(receipt.issuedAt)} · {formatTime(receipt.issuedAt)}</small></div>
        </header>
        <div className="ci-rule" />
        <section className="ci-party-grid">
          <div><h2>Organización</h2>{issuer.taxId && <p>Documento: {issuer.taxId}</p>}{issuer.address && <p>{issuer.address}</p>}{issuer.phone && <p>Tel. {issuer.phone}</p>}{issuer.email && <p>{issuer.email}</p>}</div>
          <div><h2>Recibido de</h2><p className="ci-customer">{customer.name}</p><p>{customer.phone}</p></div>
        </section>
        <section className="ci-detail">
          <div className="ci-concept"><span>Concepto</span><strong>{purchase.concept}</strong><small>Sorteo: {purchase.raffle}</small></div>
          <div className="ci-line"><span>Cantidad</span><strong>{purchase.quantity.toLocaleString('es-CO')} {purchase.unitLabel}</strong></div>
          <div className="ci-line"><span>Valor por {purchase.unitLabel.replace(/s$/, '')}</span><strong>{cop(purchase.unitPriceCop)}</strong></div>
          <div className="ci-total"><span>Total recibido</span><strong>{cop(purchase.totalCop)}</strong></div>
          <p className="ci-paid">Pago verificado el {formatDay(receipt.snapshot.paidAt)} · {formatTime(receipt.snapshot.paidAt)}</p>
        </section>
        <section className="ci-numbers"><h2>Boletos incluidos ({purchase.numbers.length})</h2>{purchase.numbers.length > 300 ? <p>{printNumbers(purchase.numbers)}</p> : <div>{purchase.numbers.map((number) => <span key={number}>{number}</span>)}</div>}</section>
        <footer className="ci-footer"><p>{issuer.name} · {receiptNumber(receipt.sequence)}</p>{receipt.voidedAt && <strong className="ci-void-banner">ANULADO{receipt.voidReason ? ` · ${receipt.voidReason}` : ''}</strong>}<p>{receipt.snapshot.footer || 'Gracias por tu compra.'}</p>{receipt.snapshot.disclaimer && <small>{receipt.snapshot.disclaimer}</small>}</footer>
      </article>
    </div>
  );
}
