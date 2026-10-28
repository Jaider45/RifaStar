import { useNavigate, useParams } from 'react-router-dom';
import { useCan, useOrgMutation, useOrgQuery } from '@/api/hooks';
import { PageHeader } from '@/components/PageHeader';
import { Empty, ErrorNote, Loading } from '@/components/ui';
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
  const eligible = useOrgQuery<Eligible[]>(id ? null : '/v1/receipts/eligible');
  const issued = useOrgQuery<Issued[]>(id ? null : '/v1/receipts');
  const issue = useOrgMutation<string, IncomeReceipt>((orderId, req) => req(`/v1/receipts/orders/${orderId}`, { method: 'POST' }));

  if (!can('receipts.issue')) return <ErrorNote error={new Error('No tienes permiso para emitir comprobantes.')} />;
  if (id) return <ReceiptView receipt={detail.data} loading={!detail.data && !detail.error} error={detail.error} />;

  return (
    <>
      <PageHeader title="Comprobantes de ingreso" sub="Emite un comprobante cuando verifiques un pago. Cada compra aprobada puede tener un comprobante numerado." actions={<button type="button" className="rs-btn rs-btn--secundario" onClick={() => navigate('/admin/ajustes?tab=comprobantes')}>Personalizar comprobante</button>} />
      <ErrorNote error={eligible.error ?? issued.error ?? issue.error} />
      <section className="rs-panel panel-pad ci-section">
        <div>
          <h2 className="h2 h2--lg">Compras sin comprobante</h2>
          <p className="muted">Solo aparecen compras con pago aprobado.</p>
        </div>
        {!eligible.data ? <Loading /> : eligible.data.length === 0 ? <Empty>Todas las compras aprobadas ya tienen comprobante.</Empty> : (
          <div className="table-scroll"><table className="rs-tabla">
            <thead><tr><th>Cliente</th><th>Sorteo</th><th>Boletos</th><th>Total recibido</th><th>Pago aprobado</th><th /></tr></thead>
            <tbody>{eligible.data.map((row) => (
              <tr key={row.orderId}>
                <td>{row.customer}</td><td>{row.raffle}</td><td>{row.quantity.toLocaleString('es-CO')}</td>
                <td className="td-mono">{cop(row.totalCop)}</td><td>{formatDay(row.paidAt)} · {formatTime(row.paidAt)}</td>
                <td><button type="button" className="rs-btn rs-btn--primario rs-btn--sm" disabled={issue.isPending} onClick={() => issue.mutateAsync(row.orderId).then((receipt) => navigate(`/admin/comprobantes/${receipt.id}`)).catch(() => undefined)}>{issue.isPending ? 'Generando…' : 'Generar'}</button></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </section>

      <section className="rs-panel panel-pad ci-section">
        <div><h2 className="h2 h2--lg">Emitidos</h2><p className="muted">Los comprobantes emitidos conservan los datos y el concepto originales.</p></div>
        {!issued.data ? <Loading /> : issued.data.length === 0 ? <Empty>Aún no has emitido comprobantes.</Empty> : (
          <div className="table-scroll"><table className="rs-tabla">
            <thead><tr><th>Número</th><th>Cliente</th><th>Boletos</th><th>Ingreso</th><th>Fecha de emisión</th><th>Estado</th><th /></tr></thead>
            <tbody>{issued.data.map((row) => (
              <tr key={row.id}>
                <td className="td-mono">{receiptNumber(row.sequence)}</td><td>{row.customer}</td><td>{row.quantity}</td><td className="td-mono">{cop(row.totalCop)}</td><td>{formatDay(row.issuedAt)}</td>
                <td>{row.voidedAt ? <span className="ci-state ci-state--void">Anulado</span> : <span className="ci-state">Vigente</span>}</td>
                <td><button type="button" className="rs-btn rs-btn--secundario rs-btn--sm" onClick={() => navigate(`/admin/comprobantes/${row.id}`)}>Abrir</button></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </section>
    </>
  );
}

function ReceiptView({ receipt, loading, error }: { receipt?: IncomeReceipt; loading: boolean; error: unknown }) {
  const navigate = useNavigate();
  if (loading) return <Loading />;
  if (error || !receipt) return <><PageHeader title="Comprobante" crumb={{ to: '/admin/comprobantes', label: 'Volver a comprobantes' }} /><ErrorNote error={error ?? new Error('No encontramos el comprobante.')} /></>;
  const { issuer, customer, purchase } = receipt.snapshot;
  return (
    <div className="ci-print-shell">
      <div className="ci-toolbar"><button type="button" className="rs-btn rs-btn--secundario" onClick={() => navigate('/admin/comprobantes')}>Volver</button><button type="button" className="rs-btn rs-btn--primario" onClick={() => window.print()}>Imprimir o guardar PDF</button></div>
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
