import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { uploadToStorage } from '@/api/client';
import { useCan, useOrgMutation, useOrgProfile, useOrgQuery } from '@/api/hooks';
import type { Raffle, Upload } from '@/api/types';
import { Badge } from '@/components/Badge';
import { Icon } from '@/components/Icon';
import { Logo } from '@/components/Logo';
import { PageHeader } from '@/components/PageHeader';
import { Empty, ErrorNote, Loading, OkNote } from '@/components/ui';
import { cop } from '@/lib/format';
import { formatPhone } from '@/lib/phone';
import { formatDay } from '@/lib/time';
import './Ganador.css';

const NOMBRES_DIGITO = ['Primer', 'Segundo', 'Tercer', 'Cuarto'];

interface WinnerRow {
  id: string;
  number: string;
  unsold: boolean;
  label: string;
  participant: { name: string; phone: string } | null;
  ticketCode: string | null;
  deliveryStatus: 'pending' | 'delivered';
  deliveredAt: string | null;
}

interface WinnersView {
  raffle: { id: string; title: string; status: string; digits: number; resultsPublishedAt: string | null };
  result: { mainResult: string; anticipatedResult: string | null; revision: number; evidenceUrls: string[] } | null;
  prizes: {
    prizeId: string;
    position: number;
    amountCop: number | null;
    description: string | null;
    ruleLabel: string;
    pending: boolean;
    pendingReason: string | null;
    winners: WinnerRow[];
  }[];
}

/** «Laura Martínez» → «Laura M.» (así se anuncia en público). */
const nombreCorto = (nombre: string) => {
  const [n, a] = nombre.split(' ');
  return a ? `${n} ${a[0]}.` : n;
};

const premioTexto = (p: { amountCop: number | null; description: string | null }) => (p.amountCop ? cop(p.amountCop) : (p.description ?? 'Premio'));

export default function Ganador() {
  const { id } = useParams();
  const navigate = useNavigate();
  const can = useCan();
  const { data: org } = useOrgProfile();
  const raffles = useOrgQuery<Raffle[]>('/v1/raffles');
  const candidatos = (raffles.data ?? []).filter((r) => ['active', 'sold_out', 'closed', 'drawn'].includes(r.status));
  const raffleId = id ?? candidatos.find((r) => r.status === 'closed' || r.status === 'sold_out')?.id ?? candidatos[0]?.id;

  useEffect(() => {
    if (!id && raffleId) navigate(`/admin/ganadores/${raffleId}`, { replace: true });
  }, [id, raffleId, navigate]);

  const raffle = useOrgQuery<Raffle>(raffleId ? `/v1/raffles/${raffleId}` : null);
  const view = useOrgQuery<WinnersView>(raffleId ? `/v1/raffles/${raffleId}/winners` : null);
  const [digitos, setDigitos] = useState(['', '', '', '']);
  const [anticipado, setAnticipado] = useState('');
  const [ok, setOk] = useState<string | null>(null);
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    const r = view.data?.result;
    setDigitos(r ? r.mainResult.split('') : ['', '', '', '']);
    setAnticipado(r?.anticipatedResult ?? '');
    setOk(null);
  }, [view.data?.result, raffleId]);

  const guardar = useOrgMutation<void>((_v, req) =>
    req(`/v1/raffles/${raffleId}/result`, {
      method: 'PUT',
      body: { mainResult: digitos.join(''), ...(anticipado.length === 4 && { anticipatedResult: anticipado }) },
    }).then(() => undefined),
  );
  const entregar = useOrgMutation<string>((wid, req) => req(`/v1/winners/${wid}/deliver`, { body: {} }).then(() => undefined));
  const publicar = useOrgMutation<void>((_v, req) => req(`/v1/raffles/${raffleId}/results/publish`, { method: 'POST' }).then(() => undefined));
  const avisar = useOrgMutation<void, { queued: number }>((_v, req) => req(`/v1/raffles/${raffleId}/results/notify`, { method: 'POST' }));
  const evidencia = useOrgMutation<File>(async (file, req) => {
    const up = await req<Upload>(`/v1/raffles/${raffleId}/result/evidence`, { body: { contentType: file.type, size: file.size } });
    await uploadToStorage(up, file);
    await req(`/v1/raffles/${raffleId}/result/evidence/confirm`, { body: { key: up.key } });
  });

  const cambiarDigito = (i: number, valor: string) => {
    const d = valor.replace(/\D/g, '').slice(-1);
    setDigitos((cur) => cur.map((x, k) => (k === i ? d : x)));
    if (d && i < 3) refs.current[i + 1]?.focus();
  };

  if (raffles.isLoading) return <Loading />;
  if (!raffleId) {
    return (
      <>
        <PageHeader title="Anunciar ganadores" />
        <Empty>Cuando tengas un sorteo publicado podrás registrar aquí su resultado.</Empty>
      </>
    );
  }

  const v = view.data;
  const r = raffle.data;
  const tz = org?.timezone;
  const completo = digitos.every((d) => d !== '');
  const tieneAnticipado = Boolean(r?.prizes.some((p) => p.rule.startsWith('anticipated')));
  const premioAnticipado = r?.prizes.find((p) => p.rule.startsWith('anticipated'));
  const publicado = Boolean(v?.raffle.resultsPublishedAt);
  type Fila = { p: WinnersView['prizes'][number]; w: WinnerRow | null };
  const filas: Fila[] = (v?.prizes ?? []).flatMap((p): Fila[] => (p.winners.length ? p.winners.map((w) => ({ p, w })) : [{ p, w: null }]));
  const vendidos = filas.filter((f) => f.w && !f.w.unsold).length;
  const mayor = filas[0];
  const error = view.error ?? guardar.error ?? entregar.error ?? publicar.error ?? avisar.error ?? evidencia.error;
  const editable = can('winners.announce') && !publicado;

  return (
    <>
      <PageHeader
        crumb={{ to: '/admin', label: `${r?.title ?? 'Sorteo'}${r ? ` · ${formatDay(r.drawAt, tz)}` : ''} /` }}
        title="Anunciar ganadores"
        sub="Escribe el resultado de la lotería. Rifa Star calcula los ganadores de cada premio con los números pagos."
        actions={
          <select className="rs-in" aria-label="Sorteo" value={raffleId} onChange={(e) => navigate(`/admin/ganadores/${e.target.value}`)} style={{ width: 280 }}>
            {candidatos.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
          </select>
        }
      />

      <ErrorNote error={error} />
      {ok && <OkNote>{ok}</OkNote>}

      <div className="split">
        <div className="split__main">
          <section className="rs-panel resultado">
            <fieldset className="bare-fieldset" disabled={!editable}>
              <legend className="rs-label">Resultado {r?.lottery}</legend>
              <div className="resultado__digitos">
                {digitos.map((d, i) => (
                  <input
                    key={i}
                    ref={(el) => { refs.current[i] = el; }}
                    className="rs-in rs-mono resultado__digito"
                    value={d}
                    inputMode="numeric"
                    aria-label={`${NOMBRES_DIGITO[i]} dígito`}
                    onChange={(e) => cambiarDigito(i, e.target.value)}
                    onFocus={(e) => e.target.select()}
                  />
                ))}
              </div>
            </fieldset>
            {tieneAnticipado && (
              <div>
                <label className="rs-label" htmlFor="antio">Anticipado · {premioAnticipado?.anticipatedLottery}</label>
                <input
                  id="antio"
                  className="rs-in rs-mono resultado__anticipado"
                  value={anticipado}
                  inputMode="numeric"
                  maxLength={4}
                  disabled={!editable}
                  placeholder="0000"
                  onChange={(e) => setAnticipado(e.target.value.replace(/\D/g, ''))}
                />
              </div>
            )}
            {editable && (
              <button
                type="button"
                className="rs-btn rs-btn--primario"
                disabled={!completo || guardar.isPending}
                onClick={() => guardar.mutateAsync().then(() => setOk('Resultado guardado y ganadores calculados.')).catch(() => undefined)}
              >
                {v?.result ? 'Corregir resultado' : 'Calcular ganadores'}
              </button>
            )}
            {v?.result && (
              <div className="resultado__prueba">
                <span className="rs-label" style={{ margin: 0 }}>Prueba</span>
                {v.result.evidenceUrls.map((u, i) => (
                  <a key={u} href={u} target="_blank" rel="noreferrer" className="small-link">Archivo {i + 1}</a>
                ))}
                {can('winners.announce') && (
                  <label className="rs-btn rs-btn--secundario">
                    <Icon name="upload" size={18} />
                    {evidencia.isPending ? 'Subiendo…' : 'Subir foto o video del resultado'}
                    <input
                      type="file"
                      accept="image/*,video/mp4,video/quicktime"
                      className="sr-only"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) evidencia.mutateAsync(f).then(() => setOk('Evidencia adjunta.')).catch(() => undefined);
                        e.target.value = '';
                      }}
                    />
                  </label>
                )}
              </div>
            )}
          </section>

          <section className="rs-panel overflow-hidden">
            <div className="panel-head">
              <h2 className="h2">Ganadores calculados</h2>
              <Badge tono={filas.length && vendidos === filas.length ? 'abierto' : 'cerrado'}>
                {vendidos} de {filas.length} vendidos
              </Badge>
            </div>
            {view.isLoading ? (
              <Loading />
            ) : (
              <div className="table-scroll">
                <table className="rs-tabla" style={{ minWidth: 640 }}>
                  <thead>
                    <tr><th>Premio</th><th>Número</th><th>Ganador</th><th>Monto</th><th>Entrega</th></tr>
                  </thead>
                  <tbody>
                    {filas.map(({ p, w }, i) => (
                      <tr key={`${p.prizeId}-${w?.id ?? 'x'}`}>
                        <td>{p.ruleLabel}</td>
                        <td>
                          <span className={`num-tag${i === 0 ? ' num-tag--oro' : ''}`}>{w?.number ?? '––'}</span>
                        </td>
                        <td>
                          {w && !w.unsold ? (
                            <>
                              <b>{w.participant?.name}</b><br />
                              <span className="cell-sub">{formatPhone(w.participant?.phone)} {w.ticketCode && `· ${w.ticketCode}`}</span>
                            </>
                          ) : (
                            <>
                              <b>Sin ganador</b><br />
                              <span className="cell-sub">{w ? 'Número no vendido' : (p.pendingReason ?? 'Falta el resultado')}</span>
                            </>
                          )}
                        </td>
                        <td className="td-mono">{premioTexto(p)}</td>
                        <td>
                          {!w || w.unsold ? (
                            <span className="cell-sub">—</span>
                          ) : w.deliveryStatus === 'delivered' ? (
                            <Badge tono="abierto">Entregado</Badge>
                          ) : can('winners.announce') ? (
                            <button type="button" className="rs-btn rs-btn--secundario rs-btn--sm" disabled={entregar.isPending} onClick={() => entregar.mutate(w.id)}>
                              Marcar entregado
                            </button>
                          ) : (
                            <span className="cell-sub">Pendiente</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>

        <aside aria-label="Pieza para estados de WhatsApp" className="split__aside" style={{ flexBasis: 320 }}>
          <span className="eyebrow">Pieza para estados y grupos</span>
          <div className="rs-oscuro pieza">
            <span aria-hidden="true" className="pieza__dado pieza__dado--rojo" />
            <span aria-hidden="true" className="pieza__dado pieza__dado--verde" />
            <Logo variante="blanco" className="pieza__logo" />
            <div className="pieza__body">
              <span className="rs-badge rs-badge--ganador" style={{ alignSelf: 'flex-start' }}>★ Ganador</span>
              <span className="rs-display pieza__titulo">
                ¡Felicidades, {mayor?.w && !mayor.w.unsold ? nombreCorto(mayor.w.participant!.name) : '[Nombre]'}!
              </span>
              <div className="pieza__premio">
                <span className="rs-mono pieza__numero">{mayor?.w?.number ?? '––'}</span>
                <span className="pieza__regla">
                  {mayor?.p.ruleLabel}<br />
                  <b className="rs-display">{mayor ? premioTexto(mayor.p) : ''}</b>
                </span>
              </div>
              <span className="pieza__pie">
                {r?.lottery} · {r ? formatDay(r.drawAt, tz) : ''} · Resultado {v?.result?.mainResult ?? '––––'}
              </span>
            </div>
          </div>
          {can('winners.announce') && (
            <button
              type="button"
              className="rs-btn rs-btn--primario"
              disabled={!publicado || avisar.isPending}
              title={publicado ? undefined : 'Publica los resultados primero'}
              onClick={() => avisar.mutateAsync().then((x) => setOk(`Enviamos ${x.queued} ${x.queued === 1 ? 'aviso' : 'avisos'} por WhatsApp.`)).catch(() => undefined)}
            >
              <Icon name="whatsapp" size={18} />
              Avisar a los ganadores por WhatsApp
            </button>
          )}
          <div style={{ display: 'flex', gap: 10 }}>
            {publicado ? (
              <Link to={`/${org?.slug}/${r?.slug}/resultado`} className="rs-btn rs-btn--secundario" style={{ flex: 1 }}>Ver en el enlace</Link>
            ) : (
              can('winners.announce') && (
                <button
                  type="button"
                  className="rs-btn rs-btn--secundario"
                  style={{ flex: 1 }}
                  disabled={!v?.result || publicar.isPending}
                  onClick={() => publicar.mutateAsync().then(() => setOk('Resultados publicados en el enlace.')).catch(() => undefined)}
                >
                  Publicar en el enlace
                </button>
              )
            )}
            <button
              type="button"
              className="rs-btn rs-btn--secundario"
              style={{ flex: 1 }}
              disabled={!mayor?.w || mayor.w.unsold}
              onClick={() =>
                mayor?.w &&
                descargarPieza({
                  nombre: nombreCorto(mayor.w.participant!.name),
                  numero: mayor.w.number,
                  regla: mayor.p.ruleLabel,
                  premio: premioTexto(mayor.p),
                  pie: `${r?.lottery ?? ''} · ${r ? formatDay(r.drawAt, tz) : ''} · Resultado ${v?.result?.mainResult ?? ''}`,
                })
              }
            >
              Descargar imagen
            </button>
          </div>
        </aside>
      </div>
    </>
  );
}

/** Dibuja la pieza 1080×1350 en un canvas y la descarga como PNG. */
function descargarPieza(d: { nombre: string; numero: string; regla: string; premio: string; pie: string }) {
  const c = document.createElement('canvas');
  c.width = 1080;
  c.height = 1350;
  const g = c.getContext('2d');
  if (!g) return;
  g.fillStyle = '#0b0b0c';
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#ab1f24';
  g.beginPath();
  g.arc(980, 120, 150, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#7eb742';
  g.beginPath();
  g.arc(80, 1250, 180, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#f5f5f2';
  g.font = '800 64px "Bricolage Grotesque", sans-serif';
  g.fillText('Rifa Star', 80, 150);
  g.fillStyle = '#ffc53d';
  g.font = '800 40px Figtree, sans-serif';
  g.fillText('★ GANADOR', 80, 360);
  g.fillStyle = '#f5f5f2';
  g.font = '800 96px "Bricolage Grotesque", sans-serif';
  g.fillText('¡Felicidades,', 80, 480);
  g.fillText(`${d.nombre}!`, 80, 590);
  g.fillStyle = '#ffc53d';
  g.font = '700 260px "JetBrains Mono", monospace';
  g.fillText(d.numero, 80, 880);
  g.fillStyle = '#f5f5f2';
  g.font = '600 44px Figtree, sans-serif';
  g.fillText(d.regla, 80, 980);
  g.font = '800 72px "Bricolage Grotesque", sans-serif';
  g.fillText(d.premio, 80, 1070);
  g.fillStyle = '#a6a5a1';
  g.font = '600 34px Figtree, sans-serif';
  g.fillText(d.pie, 80, 1200);
  const a = document.createElement('a');
  a.href = c.toDataURL('image/png');
  a.download = `ganador-${d.numero}.png`;
  a.click();
}
