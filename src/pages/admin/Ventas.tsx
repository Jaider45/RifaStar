import { ApiError } from '@/api/client';
import { useOrgQuery } from '@/api/hooks';
import { useSession } from '@/api/session';
import type { Order } from '@/api/types';
import { Badge } from '@/components/Badge';
import { PageHeader } from '@/components/PageHeader';
import { copy, Empty, ErrorNote, Loading } from '@/components/ui';
import { cop } from '@/lib/format';
import { timeAgo } from '@/lib/time';
import { useState } from 'react';

interface Sales {
  summary: { orders: number; approvedOrders: number; numbersSold: number; approvedCop: number };
  items: Order[];
}

/** Vendedor: ventas atribuidas a su código. */
export default function Ventas() {
  const { me, activeOrgId } = useSession();
  const sales = useOrgQuery<Sales>('/v1/sales/mine');
  const code = me?.memberships.find((m) => m.organization.id === activeOrgId)?.sellerCode;
  const slug = me?.memberships.find((m) => m.organization.id === activeOrgId)?.organization.slug;
  const [copiado, setCopiado] = useState(false);

  if (sales.isLoading) return <Loading />;
  const s = sales.data;
  return (
    <>
      <PageHeader title="Mis ventas" sub={code ? `Tu código es ${code}. Agrégalo al final del enlace de cada sorteo: ?v=${code}` : 'Pide al propietario que te asigne un código de vendedor.'} />
      {sales.error instanceof ApiError && sales.error.status === 402 ? <ErrorNote error={sales.error} /> : <ErrorNote error={sales.error} />}
      {code && slug && (
        <button
          type="button"
          className="rs-btn rs-btn--secundario"
          style={{ alignSelf: 'flex-start' }}
          onClick={() => copy(`${window.location.origin}/${slug}?v=${code}`).then(() => { setCopiado(true); window.setTimeout(() => setCopiado(false), 1600); })}
        >
          {copiado ? 'Copiado' : 'Copiar mi enlace'}
        </button>
      )}
      {s && (
        <>
          <section className="kpis">
            <div className="rs-panel kpi"><span className="kpi__label">Órdenes</span><span className="kpi__value">{s.summary.orders}</span></div>
            <div className="rs-panel kpi"><span className="kpi__label">Pagadas</span><span className="kpi__value">{s.summary.approvedOrders}</span></div>
            <div className="rs-panel kpi"><span className="kpi__label">Números vendidos</span><span className="kpi__value">{s.summary.numbersSold}</span></div>
            <div className="rs-panel kpi"><span className="kpi__label">Total pagado</span><span className="kpi__value">{cop(s.summary.approvedCop)}</span></div>
          </section>
          <section className="rs-panel overflow-hidden">
            {s.items.length === 0 ? (
              <Empty>Todavía no tienes ventas con tu código.</Empty>
            ) : (
              <div className="table-scroll">
                <table className="rs-tabla" style={{ minWidth: 640 }}>
                  <thead><tr><th>Participante</th><th>Sorteo</th><th>Números</th><th>Valor</th><th>Estado</th><th>Cuándo</th></tr></thead>
                  <tbody>
                    {s.items.map((o) => (
                      <tr key={o.id}>
                        <td><b>{o.participant.name}</b><br /><span className="cell-sub">{o.participant.phone}</span></td>
                        <td>{o.raffle.title}</td>
                        <td className="rs-mono">{o.numbers.join(', ')}</td>
                        <td className="td-mono">{cop(o.totalCop)}</td>
                        <td><Badge tono={o.status === 'approved' ? 'abierto' : o.status === 'pending_verification' ? 'urgente' : 'cerrado'}>{o.statusLabel}</Badge></td>
                        <td className="cell-sub">{timeAgo(o.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </>
  );
}
