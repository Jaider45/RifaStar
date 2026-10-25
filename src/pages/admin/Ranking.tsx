import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError } from '@/api/client';
import { useCan, useOrgMutation, useOrgProfile, useOrgQuery } from '@/api/hooks';
import { useSession } from '@/api/session';
import { PageHeader } from '@/components/PageHeader';
import { copy, Empty, ErrorNote, Loading, Modal, OkNote } from '@/components/ui';
import { descargar } from '@/lib/download';
import { cop } from '@/lib/format';
import { formatPhone } from '@/lib/phone';
import { formatDay, monthLabel } from '@/lib/time';
import { useCountdown } from '@/lib/useCountdown';
import './Ranking.css';

interface Period { id: string; label: string; frequency: string; status: 'open' | 'closed'; startsAt: string; endsAt: string }
interface Row { rank: number; participantId: string; name: string; phone?: string; maskedPhone?: string; points: number; raffles: number; investedCop: number; change?: number | null }
interface Current { enabled: boolean; period?: Period; prizes?: string[]; tiebreaker?: string; standings?: Row[] }

function Reinicio({ endsAt }: { endsAt: string }) {
  const r = useCountdown(new Date(endsAt).getTime());
  return <span className="rs-mono ranking-resumen__reloj">{r.dias} d {r.horas} h</span>;
}

export default function Ranking() {
  const can = useCan();
  const { orgRequest } = useSession();
  const { data: org } = useOrgProfile();
  const [busqueda, setBusqueda] = useState('');
  const [periodoId, setPeriodoId] = useState<string>('');
  const [ajuste, setAjuste] = useState<Row | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const current = useOrgQuery<Current>('/v1/ranking/current');
  const periods = useOrgQuery<Period[]>(current.data?.enabled ? '/v1/ranking/periods' : null);
  const viendoAnterior = periodoId && periodoId !== current.data?.period?.id;
  const historico = useOrgQuery<{ period: Period; standings: Row[] }>(viendoAnterior ? `/v1/ranking/periods/${periodoId}` : null);
  const anunciar = useOrgMutation<string, { queued: number }>((id, req) => req(`/v1/ranking/periods/${id}/announce`, { method: 'POST' }));

  if (current.isLoading) return <Loading />;
  if (current.error instanceof ApiError && current.error.status === 402) {
    return (
      <>
        <PageHeader title="Ranking" />
        <div className="rs-panel panel-pad">
          <ErrorNote error={current.error} />
          {can('settings.billing') && <Link to="/admin/ajustes?tab=plan" className="rs-btn rs-btn--primario" style={{ alignSelf: 'flex-start' }}>Ver planes</Link>}
        </div>
      </>
    );
  }
  if (current.error) return <ErrorNote error={current.error} />;
  if (!current.data?.enabled) {
    return (
      <>
        <PageHeader title="Ranking" sub="Lista pública de quienes más participan. Motiva a comprar más números cada mes." />
        <div className="rs-panel panel-pad">
          <p className="muted">El ranking está apagado.</p>
          {can('ranking.configure') && <Link to="/admin/ajustes?tab=ranking" className="rs-btn rs-btn--primario" style={{ alignSelf: 'flex-start' }}>Activar en Ajustes</Link>}
        </div>
      </>
    );
  }

  const c = current.data;
  const periodo = viendoAnterior ? historico.data?.period : c.period;
  const filasBase = (viendoAnterior ? historico.data?.standings : c.standings) ?? [];
  const q = busqueda.trim().toLowerCase();
  const filas = filasBase.filter((f) => !q || f.name.toLowerCase().includes(q));
  const enlace = `${window.location.origin}/${org?.slug}/ranking`;
  const titulo = periodo ? `Ranking de ${monthLabel(periodo.label)}` : 'Ranking';

  return (
    <>
      <PageHeader
        title={titulo}
        sub={periodo ? `Del ${formatDay(periodo.startsAt, org?.timezone)} al ${formatDay(new Date(new Date(periodo.endsAt).getTime() - 1).toISOString(), org?.timezone)}. Solo cuentan números pagados.` : undefined}
        actions={
          <>
            <select className="rs-in" aria-label="Periodo" style={{ width: 200 }} value={periodoId || c.period?.id} onChange={(e) => setPeriodoId(e.target.value)}>
              {(periods.data ?? []).map((p) => (
                <option key={p.id} value={p.id}>{monthLabel(p.label)}{p.status === 'open' ? ' (actual)' : ''}</option>
              ))}
            </select>
            {can('ranking.configure') && <Link to="/admin/ajustes?tab=ranking" className="rs-btn rs-btn--secundario">Configurar</Link>}
          </>
        }
      />

      {ok && <OkNote>{ok}</OkNote>}
      <ErrorNote error={anunciar.error ?? historico.error} />

      <section className="ranking-resumen">
        <div className="rs-panel kpi">
          <span className="kpi__label">{periodo?.status === 'closed' ? 'Cerró el' : 'Se reinicia en'}</span>
          {periodo?.status === 'closed' ? (
            <span className="rs-mono ranking-resumen__reloj">{formatDay(periodo.endsAt, org?.timezone)}</span>
          ) : (
            periodo && <Reinicio endsAt={periodo.endsAt} />
          )}
          <span className="kpi__note">Cada periodo queda guardado en el historial.</span>
        </div>
        <div className="rs-panel kpi">
          <span className="kpi__label">Participantes en el ranking</span>
          <span className="kpi__value" style={{ fontSize: 30 }}>{filasBase.length}</span>
        </div>
        <div className="rs-panel kpi ranking-resumen__enlace">
          <span className="kpi__label">Enlace público del ranking</span>
          <div className="ranking-enlace">
            <span className="rs-mono ranking-enlace__url">{enlace.replace(/^https?:\/\//, '')}</span>
            <button type="button" className="rs-btn rs-btn--primario rs-btn--sm" onClick={() => copy(enlace).then(() => setOk('Enlace copiado.'))}>Copiar</button>
            <Link to={`/${org?.slug}/ranking`} className="rs-btn rs-btn--secundario rs-btn--sm">Ver</Link>
          </div>
        </div>
      </section>

      <div className="split">
        <section className="rs-panel overflow-hidden" style={{ flex: '999 1 560px', minWidth: 0 }}>
          <div className="panel-head">
            <h2 className="h2">Posiciones</h2>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <input className="rs-in" placeholder="Buscar participante" aria-label="Buscar participante" style={{ width: 220 }} value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
              {can('ranking.configure') && periodo && (
                <button type="button" className="rs-btn rs-btn--secundario rs-btn--sm" onClick={() => descargar(orgRequest, `/v1/ranking/periods/${periodo.id}/export.csv`, `ranking-${periodo.label}.csv`)}>
                  Exportar CSV
                </button>
              )}
            </div>
          </div>
          {filas.length === 0 ? (
            <Empty>{filasBase.length ? 'Nadie coincide con la búsqueda.' : 'Todavía no hay puntos en este periodo.'}</Empty>
          ) : (
            <div className="table-scroll">
              <table className="rs-tabla" style={{ minWidth: 620 }}>
                <thead>
                  <tr><th style={{ width: 64 }}>#</th><th>Participante</th><th>Puntos</th><th>Sorteos</th><th>Invertido</th><th>Desde ayer</th>{can('ranking.configure') && !viendoAnterior && <th />}</tr>
                </thead>
                <tbody>
                  {filas.map((f) => (
                    <tr key={f.participantId}>
                      <td><span className={`rs-mono pos pos--${f.rank === 1 ? 'oro' : f.rank <= 3 ? 'podio' : 'resto'}`}>{f.rank}</span></td>
                      <td>
                        <b>{f.name}</b><br />
                        <span className="cell-sub" style={{ fontSize: 13 }}>{f.phone ? formatPhone(f.phone) : f.maskedPhone}</span>
                      </td>
                      <td className="td-mono">{f.points}</td>
                      <td>{f.raffles}</td>
                      <td className="rs-mono">{cop(f.investedCop)}</td>
                      <td className={`cambio cambio--${(f.change ?? 0) > 0 ? 'sube' : (f.change ?? 0) < 0 ? 'baja' : 'igual'}`}>
                        {f.change == null ? 'nuevo' : f.change > 0 ? `▲ ${f.change}` : f.change < 0 ? `▼ ${Math.abs(f.change)}` : '—'}
                      </td>
                      {can('ranking.configure') && !viendoAnterior && (
                        <td className="td-right">
                          <button type="button" className="rs-btn rs-btn--fantasma rs-btn--sm" onClick={() => setAjuste(f)}>Ajustar</button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <aside className="rs-panel premios-mes">
          <div>
            <h2 className="h2 h2--sm">Premios del periodo</h2>
            <p className="rs-help">Se entregan al cerrar el ranking. Edítalos en Ajustes.</p>
          </div>
          {(c.prizes ?? []).length === 0 && <p className="rs-help">Sin premios configurados.</p>}
          {(c.prizes ?? []).map((p, i) => (
            <div key={p + i} className="premios-mes__fila">
              <span className={`rs-mono premios-mes__pos${i === 0 ? ' premios-mes__pos--oro' : ''}`}>{i + 1}</span>
              <span className="premios-mes__txt">{p}</span>
            </div>
          ))}
          <div className="note note--fondo">
            Empate: {c.tiebreaker === 'most_raffles' ? 'gana quien jugó más sorteos.' : 'gana quien llegó primero a esos puntos.'}
          </div>
          {can('ranking.configure') && periodo && (
            <button
              type="button"
              className="rs-btn rs-btn--secundario"
              disabled={anunciar.isPending}
              onClick={() => anunciar.mutateAsync(periodo.id).then((r) => setOk(`Enviamos el top 10 a ${r.queued} participantes.`)).catch(() => undefined)}
            >
              Anunciar top 10 por WhatsApp
            </button>
          )}
        </aside>
      </div>

      {ajuste && <AjustePuntos fila={ajuste} onClose={() => setAjuste(null)} onDone={() => { setAjuste(null); setOk('Ajuste registrado en el libro de puntos.'); }} />}
    </>
  );
}

function AjustePuntos({ fila, onClose, onDone }: { fila: Row; onClose: () => void; onDone: () => void }) {
  const [points, setPoints] = useState('1');
  const [reason, setReason] = useState('');
  const m = useOrgMutation<void>((_v, req) => req('/v1/ranking/adjustments', { body: { participantId: fila.participantId, points: Number(points), reason } }).then(() => undefined));
  return (
    <Modal
      title={`Ajustar puntos de ${fila.name}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="rs-btn rs-btn--secundario" onClick={onClose}>Cancelar</button>
          <button type="button" className="rs-btn rs-btn--primario" disabled={!Number(points) || reason.trim().length < 3 || m.isPending} onClick={() => m.mutateAsync().then(onDone).catch(() => undefined)}>
            Registrar ajuste
          </button>
        </>
      }
    >
      <p className="rs-help">El ajuste queda en el libro de puntos y en el registro de actividad; no se puede borrar. Usa negativos para restar.</p>
      <div className="grid-auto">
        <div>
          <label className="rs-label" htmlFor="pts">Puntos</label>
          <input id="pts" className="rs-in rs-mono" value={points} onChange={(e) => setPoints(e.target.value.replace(/[^\d-]/g, ''))} />
        </div>
        <div>
          <label className="rs-label" htmlFor="mot">Motivo</label>
          <input id="mot" className="rs-in" value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
      </div>
      <ErrorNote error={m.error} />
    </Modal>
  );
}
