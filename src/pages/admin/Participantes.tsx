import { useState } from 'react';
import { useCan, useOrgQuery } from '@/api/hooks';
import { useSession } from '@/api/session';
import { PageHeader } from '@/components/PageHeader';
import { Empty, ErrorNote, Loading, Modal } from '@/components/ui';
import { descargar } from '@/lib/download';
import { cop } from '@/lib/format';
import { formatPhone, waLink } from '@/lib/phone';
import { timeAgo } from '@/lib/time';

interface Item { id: string; name: string; nickname: string | null; phone: string; firstSeenAt: string; lastSeenAt: string; ticketsCount: number }
interface Detail {
  id: string;
  name: string;
  phone: string;
  totals: { approvedOrders: number; paidNumbers: number; paidCop: number };
  orders: { id: string; raffle: { title: string }; numbers: string[]; totalCop: number; status: string; createdAt: string }[];
  tickets: { id: string; code: string }[];
}

const ESTADOS: Record<string, string> = {
  reserved: 'Apartado', pending_verification: 'Por verificar', approved: 'Pagado', rejected: 'Rechazado', expired: 'Vencido', released: 'Liberado',
};

export default function Participantes() {
  const can = useCan();
  const { orgRequest } = useSession();
  const [q, setQ] = useState('');
  const [busqueda, setBusqueda] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  const list = useOrgQuery<{ items: Item[]; nextCursor: string | null }>(`/v1/participants?limit=100${busqueda ? `&q=${encodeURIComponent(busqueda)}` : ''}`);
  const detail = useOrgQuery<Detail>(sel ? `/v1/participants/${sel}` : null);

  return (
    <>
      <PageHeader
        title="Participantes"
        sub="Quienes han comprado o pedido aviso en tus sorteos."
        actions={
          can('participants.export') && (
            <button type="button" className="rs-btn rs-btn--secundario" onClick={() => descargar(orgRequest, '/v1/participants/export.csv', 'participantes.csv')}>
              Exportar CSV
            </button>
          )
        }
      />
      <form className="chips" onSubmit={(e) => { e.preventDefault(); setBusqueda(q.trim()); }}>
        <input className="rs-in" placeholder="Nombre o últimos dígitos del WhatsApp" aria-label="Buscar participante" style={{ width: 320 }} value={q} onChange={(e) => setQ(e.target.value)} />
        <button type="submit" className="rs-btn rs-btn--secundario">Buscar</button>
      </form>
      <ErrorNote error={list.error} />
      <section className="rs-panel overflow-hidden">
        {list.isLoading ? (
          <Loading />
        ) : list.data?.items.length === 0 ? (
          <Empty>No hay participantes{busqueda ? ' con esa búsqueda' : ' todavía'}.</Empty>
        ) : (
          <div className="table-scroll">
            <table className="rs-tabla" style={{ minWidth: 640 }}>
              <thead><tr><th>Participante</th><th>WhatsApp</th><th>Boletos</th><th>Primer contacto</th><th>Última vez</th></tr></thead>
              <tbody>
                {list.data?.items.map((p) => (
                  <tr key={p.id} onClick={() => setSel(p.id)} style={{ cursor: 'pointer' }}>
                    <td><b>{p.name}</b>{p.nickname && <span className="cell-sub"> · {p.nickname}</span>}</td>
                    <td className="rs-mono">{formatPhone(p.phone)}</td>
                    <td className="td-mono">{p.ticketsCount}</td>
                    <td className="cell-sub">{timeAgo(p.firstSeenAt)}</td>
                    <td className="cell-sub">{timeAgo(p.lastSeenAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {sel && (
        <Modal title={detail.data?.name ?? 'Participante'} onClose={() => setSel(null)}>
          {!detail.data ? (
            <Loading />
          ) : (
            <>
              <a href={waLink(detail.data.phone)} target="_blank" rel="noreferrer" className="strong-link">{formatPhone(detail.data.phone)}</a>
              <p className="rs-help">
                {detail.data.totals.approvedOrders} compras pagadas · {detail.data.totals.paidNumbers} números · {cop(detail.data.totals.paidCop)}
              </p>
              <div className="list-card">
                {detail.data.orders.map((o) => (
                  <div key={o.id} className="list-row" style={{ justifyContent: 'space-between' }}>
                    <span>
                      <b>{o.raffle.title}</b><br />
                      <span className="cell-sub rs-mono">{o.numbers.join(', ')}</span>
                    </span>
                    <span className="cell-sub">{ESTADOS[o.status] ?? o.status} · {cop(o.totalCop)}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </Modal>
      )}
    </>
  );
}
