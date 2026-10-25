import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { uploadToStorage } from '@/api/client';
import { useCan, useOrgMutation, useOrgProfile, useOrgQuery } from '@/api/hooks';
import type { PaymentAccount, PrizeRule, Raffle, Upload } from '@/api/types';
import { Icon } from '@/components/Icon';
import { Logo } from '@/components/Logo';
import { PageHeader } from '@/components/PageHeader';
import { copy, ErrorNote, Loading, Modal, OkNote } from '@/components/ui';
import { ACENTOS, acentoPorColor, LOTERIAS } from '@/lib/acentos';
import { cop, pad, soloDigitos } from '@/lib/format';
import { formatDraw, isoToZoned, zonedToIso } from '@/lib/time';
import { ESTADO_SORTEO } from './Sorteos';
import './Constructor.css';
import { slugify } from '@/lib/slug';

const slugify60 = (s: string) => slugify(s, 60);

const PASOS = [
  { id: 'info', nombre: 'Información' },
  { id: 'numeros', nombre: 'Precio y números' },
  { id: 'premios', nombre: 'Premios' },
  { id: 'pago', nombre: 'Pagos' },
  { id: 'diseno', nombre: 'Diseño' },
];

/** Reglas de premio por cifras (P3: coincidencia exacta). */
const REGLAS: Record<2 | 3 | 4, { rule: PrizeRule; label: string }[]> = {
  2: [
    { rule: 'last_two', label: 'Dos últimas cifras' },
    { rule: 'first_two', label: 'Dos primeras cifras' },
    { rule: 'middle_two', label: 'Dos del medio' },
    { rule: 'digits_1_and_4', label: 'Dígito #1 y #4' },
    { rule: 'anticipated_last_two', label: 'Anticipado (dos últimas cifras)' },
    { rule: 'custom', label: 'Regla especial' },
  ],
  3: [
    { rule: 'last_three', label: 'Tres últimas cifras' },
    { rule: 'first_three', label: 'Tres primeras cifras' },
    { rule: 'anticipated_full_number', label: 'Anticipado (tres últimas)' },
    { rule: 'custom', label: 'Regla especial' },
  ],
  4: [
    { rule: 'full_number', label: 'Número completo' },
    { rule: 'anticipated_full_number', label: 'Anticipado (número completo)' },
    { rule: 'custom', label: 'Regla especial' },
  ],
};
const ANTICIPADO: PrizeRule[] = ['anticipated_last_two', 'anticipated_full_number'];

const TIPOS_CUENTA = [
  { id: 'bre_b', label: 'Llave Bre-B' },
  { id: 'nequi', label: 'Nequi' },
  { id: 'daviplata', label: 'Daviplata' },
  { id: 'bank_transfer', label: 'Transferencia' },
] as const;

interface PremioForm {
  key: number;
  monto: string;
  descripcion: string;
  rule: PrizeRule;
  custom: string;
  anticipadoLoteria: string;
  anticipadoHora: string;
}

let seq = 0;
const nuevoPremio = (rule: PrizeRule, monto = ''): PremioForm => ({
  key: ++seq,
  monto,
  descripcion: '',
  rule,
  custom: '',
  anticipadoLoteria: 'Antioqueñita',
  anticipadoHora: '16:00',
});

/** Próximo sábado (fecha local «YYYY-MM-DD»). */
function proximoSabado(): string {
  const d = new Date();
  d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7 || 7));
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}


export default function Constructor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const can = useCan();
  const { data: org } = useOrgProfile();
  const tz = org?.timezone;
  const existing = useOrgQuery<Raffle>(id ? `/v1/raffles/${id}` : null);
  const accounts = useOrgQuery<PaymentAccount[]>(can('payments.view') ? '/v1/payment-accounts' : null);
  const paymentsSettings = useOrgQuery<{ revision: number; data: { reservationMinutes: number; requireReceipt: boolean } }>('/v1/settings/payments');

  const [paso, setPaso] = useState('info');
  const [titulo, setTitulo] = useState('');
  const [loteria, setLoteria] = useState(LOTERIAS[0]);
  const [fecha, setFecha] = useState(proximoSabado);
  const [hora, setHora] = useState('22:40');
  const [cierre, setCierre] = useState('15:30');
  const [precio, setPrecio] = useState('6000');
  const [minimo, setMinimo] = useState('1');
  const [cifras, setCifras] = useState<2 | 3 | 4>(2);
  const [premios, setPremios] = useState<PremioForm[]>(() => [nuevoPremio('last_two', '200000')]);
  const [condicion, setCondicion] = useState('');
  const [autorizacion, setAutorizacion] = useState('');
  const [cuentas, setCuentas] = useState<string[]>([]);
  const [acento, setAcento] = useState(ACENTOS[0].color);
  const [slug, setSlug] = useState('');
  const [slugTocado, setSlugTocado] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [nuevaCuenta, setNuevaCuenta] = useState(false);
  const [cancelar, setCancelar] = useState(false);
  const [cargado, setCargado] = useState<string | null>(null);

  const raffle = existing.data;
  const bloqueado = Boolean(raffle && raffle.status !== 'draft');
  const terminado = raffle?.status === 'drawn' || raffle?.status === 'cancelled';

  // Cargar el sorteo existente en el formulario.
  useEffect(() => {
    if (!raffle || cargado === raffle.id) return;
    const draw = isoToZoned(raffle.drawAt, tz);
    setTitulo(raffle.title);
    setLoteria(raffle.lottery);
    setFecha(draw.date);
    setHora(draw.time);
    setCierre(raffle.salesCloseAt ? isoToZoned(raffle.salesCloseAt, tz).time : '');
    setPrecio(String(raffle.pricePerNumber));
    setMinimo(String(raffle.minPerOrder));
    setCifras(raffle.digits);
    setPremios(
      raffle.prizes.map((p) => ({
        ...nuevoPremio(p.rule, p.amountCop ? String(p.amountCop) : ''),
        descripcion: p.description ?? '',
        custom: p.customRuleText ?? '',
        anticipadoLoteria: p.anticipatedLottery ?? 'Antioqueñita',
        anticipadoHora: p.anticipatedDrawAt ? isoToZoned(p.anticipatedDrawAt, tz).time : '16:00',
      })),
    );
    setCondicion(raffle.conditionText ?? '');
    setAutorizacion(raffle.authorizationNumber ?? '');
    setCuentas(raffle.paymentAccountIds);
    setAcento(raffle.accentColor ?? org?.defaultAccentColor ?? ACENTOS[0].color);
    setSlug(raffle.slug);
    setSlugTocado(true);
    setCargado(raffle.id);
  }, [raffle, cargado, tz, org]);

  // Sorteo nuevo: color por defecto de la org y todas las cuentas activas.
  useEffect(() => {
    if (id) return;
    if (org) setAcento(org.defaultAccentColor);
  }, [id, org]);
  useEffect(() => {
    if (!id && accounts.data && cuentas.length === 0) setCuentas(accounts.data.map((a) => a.id));
  }, [id, accounts.data]);

  const precioNum = soloDigitos(precio);
  const total = 10 ** cifras;
  const actual = acentoPorColor(acento);
  const previewStyle = { '--acento': actual.color, '--on-acento': actual.on } as CSSProperties;
  const drawIso = zonedToIso(fecha, hora, tz);

  const body = useMemo(() => {
    const prizes = premios.map((p) => ({
      ...(soloDigitos(p.monto) > 0 && { amountCop: soloDigitos(p.monto) }),
      ...(p.descripcion.trim() && { description: p.descripcion.trim() }),
      rule: p.rule,
      ...(p.rule === 'custom' && { customRuleText: p.custom.trim() }),
      ...(ANTICIPADO.includes(p.rule) && {
        anticipatedLottery: p.anticipadoLoteria.trim(),
        anticipatedDrawAt: zonedToIso(fecha, p.anticipadoHora, tz) ?? undefined,
      }),
    }));
    return {
      title: titulo.trim(),
      lottery: loteria,
      drawAt: drawIso,
      salesCloseAt: cierre ? zonedToIso(fecha, cierre, tz) : null,
      pricePerNumber: precioNum,
      digits: cifras,
      minPerOrder: Math.max(1, soloDigitos(minimo)),
      accentColor: acento,
      conditionText: condicion.trim() || null,
      authorizationNumber: autorizacion.trim() || null,
      paymentAccountIds: cuentas,
      ...(slug && { slug }),
      prizes,
    };
  }, [titulo, loteria, drawIso, cierre, fecha, tz, precioNum, cifras, minimo, acento, condicion, autorizacion, cuentas, slug, premios]);

  const guardar = useOrgMutation<void, Raffle>(async (_v, req) => {
    if (!raffle) return req<Raffle>('/v1/raffles', { body });
    const { prizes, ...rest } = body;
    const patch: Record<string, unknown> = { ...rest };
    if (bloqueado) {
      delete patch.digits;
      delete patch.pricePerNumber;
      delete patch.slug;
    }
    await req<Raffle>(`/v1/raffles/${raffle.id}`, { method: 'PATCH', body: patch });
    return req<Raffle>(`/v1/raffles/${raffle.id}/prizes`, { method: 'PUT', body: { prizes } });
  });

  const publicar = useOrgMutation<string, Raffle>((rid, req) => req<Raffle>(`/v1/raffles/${rid}/publish`, { method: 'POST' }));
  const accionSorteo = useOrgMutation<{ path: string; body?: unknown; method?: string }, unknown>((v, req) =>
    req(`/v1/raffles/${raffle!.id}${v.path ? `/${v.path}` : ''}`, { method: v.method ?? 'POST', body: v.body }),
  );
  const exigirComprobante = useOrgMutation<boolean, void>(async (value, req) => {
    const cur = paymentsSettings.data!;
    await req('/v1/settings/payments', { method: 'PUT', body: { revision: cur.revision, data: { ...cur.data, requireReceipt: value } } });
  });

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    setOk(null);
    try {
      await fn();
    } catch (err) {
      setError(err);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const guardarBorrador = () =>
    run(async () => {
      const saved = await guardar.mutateAsync();
      setOk('Cambios guardados.');
      if (!raffle) navigate(`/admin/sorteos/${saved.id}`, { replace: true });
    });

  const publicarYCopiar = () =>
    run(async () => {
      const saved = await guardar.mutateAsync();
      const pub = await publicar.mutateAsync(saved.id);
      await copy(pub.publicUrl);
      navigate('/admin', { replace: true });
    });

  const subirPortada = (file: File) =>
    run(async () => {
      const rid = raffle?.id ?? (await guardar.mutateAsync()).id;
      await accionPortada(rid, file);
      if (!raffle) navigate(`/admin/sorteos/${rid}`, { replace: true });
      setOk('Foto de portada actualizada.');
    });

  const portada = useOrgMutation<{ rid: string; file: File }>(async ({ rid, file }, req) => {
    const up = await req<Upload>(`/v1/raffles/${rid}/cover`, { body: { contentType: file.type, size: file.size } });
    await uploadToStorage(up, file);
    await req(`/v1/raffles/${rid}/cover/confirm`, { body: { key: up.key } });
  });
  const accionPortada = (rid: string, file: File) => portada.mutateAsync({ rid, file });

  const editarPremio = (key: number, campo: keyof PremioForm, valor: string) =>
    setPremios((cur) => cur.map((p) => (p.key === key ? { ...p, [campo]: valor } : p)));

  if (id && existing.isLoading) return <Loading />;
  if (id && existing.error) return <ErrorNote error={existing.error} />;

  const ocupado = guardar.isPending || publicar.isPending || portada.isPending;
  const enlaceBase = `rifastar.co/${org?.slug ?? ''}/`;

  return (
    <div className="stack constructor" style={{ gap: 24 }}>
      <PageHeader
        crumb={{ to: '/admin', label: 'Mis sorteos /' }}
        title={raffle ? raffle.title : 'Nuevo sorteo'}
        sub={
          raffle
            ? `${ESTADO_SORTEO[raffle.status].label}${raffle.status !== 'draft' ? ` · ${raffle.progress.paid} de ${raffle.totalNumbers} vendidos` : ''}`
            : 'Completa los datos y comparte el enlace. La vista previa se actualiza mientras escribes.'
        }
        actions={
          can('raffles.edit') && !terminado ? (
            <>
              <button type="button" className="rs-btn rs-btn--secundario" onClick={guardarBorrador} disabled={ocupado}>
                {raffle && raffle.status !== 'draft' ? 'Guardar cambios' : 'Guardar borrador'}
              </button>
              {(!raffle || raffle.status === 'draft') && can('raffles.publish') && (
                <button type="button" className="rs-btn rs-btn--primario" onClick={publicarYCopiar} disabled={ocupado}>
                  <Icon name="link" size={18} strokeWidth={2.2} />
                  Publicar y copiar enlace
                </button>
              )}
            </>
          ) : undefined
        }
      />

      <ErrorNote error={error} />
      {ok && <OkNote>{ok}</OkNote>}

      {raffle && raffle.status !== 'draft' && (
        <div className="chips">
          <a href={raffle.publicUrl} target="_blank" rel="noreferrer" className="rs-btn rs-btn--secundario rs-btn--sm">
            <Icon name="link" size={16} /> Ver enlace público
          </a>
          {can('raffles.publish') && (raffle.status === 'active' || raffle.status === 'sold_out') && (
            <button type="button" className="rs-btn rs-btn--secundario rs-btn--sm" onClick={() => run(async () => { await accionSorteo.mutateAsync({ path: 'close-sales' }); setOk('Venta cerrada.'); })}>
              Cerrar venta
            </button>
          )}
          {can('raffles.edit') && (
            <button type="button" className="rs-btn rs-btn--secundario rs-btn--sm" onClick={() => run(async () => { const copia = (await accionSorteo.mutateAsync({ path: 'duplicate', body: {} })) as Raffle; navigate(`/admin/sorteos/${copia.id}`); })}>
              Duplicar
            </button>
          )}
          {can('raffles.publish') && !terminado && (
            <button type="button" className="rs-btn rs-btn--fantasma rs-btn--sm" style={{ color: 'var(--rojo-texto)' }} onClick={() => setCancelar(true)}>
              Cancelar sorteo
            </button>
          )}
        </div>
      )}
      {raffle?.status === 'draft' && can('raffles.delete') && (
        <button
          type="button"
          className="rs-btn rs-btn--fantasma rs-btn--sm"
          style={{ color: 'var(--rojo-texto)', alignSelf: 'flex-start' }}
          onClick={() => run(async () => { await accionSorteo.mutateAsync({ path: '', method: 'DELETE' }); navigate('/admin'); })}
        >
          Eliminar borrador
        </button>
      )}

      <ol aria-label="Pasos" className="pasos">
        {PASOS.map((p, i) => (
          <li key={p.id}>
            <a href={`#${p.id}`} className="paso" aria-current={paso === p.id ? 'step' : undefined} onClick={() => setPaso(p.id)}>
              <span className="paso__n">{i + 1}</span>
              {p.nombre}
            </a>
          </li>
        ))}
      </ol>

      <fieldset disabled={!can('raffles.edit') || terminado} className="bare-fieldset">
        <div className="split split--24">
          <div className="split__main">
            {/* 1. Información */}
            <section id="info" className="rs-panel panel-pad">
              <div>
                <h2 className="h2">1. Información del sorteo</h2>
                <p className="rs-help">Lo primero que ve el participante al abrir el enlace.</p>
              </div>
              <div>
                <label className="rs-label" htmlFor="titulo">Título</label>
                <input
                  id="titulo"
                  className="rs-in"
                  value={titulo}
                  maxLength={120}
                  placeholder="Gana con Boyacá · Sorteo semanal"
                  onChange={(e) => {
                    setTitulo(e.target.value);
                    if (!slugTocado) setSlug(slugify60(e.target.value));
                  }}
                />
                <p className="rs-help">{titulo.length} / 120 · Sin emojis: el diseño ya pone la emoción.</p>
              </div>
              <div className="grid-auto" style={{ '--min': '180px' } as CSSProperties}>
                <div>
                  <label className="rs-label" htmlFor="loteria">Juega con</label>
                  <select id="loteria" className="rs-in" value={loteria} onChange={(e) => setLoteria(e.target.value)}>
                    {[...new Set([loteria, ...LOTERIAS])].map((l) => <option key={l}>{l}</option>)}
                  </select>
                </div>
                <div>
                  <label className="rs-label" htmlFor="fecha">Fecha del sorteo</label>
                  <input id="fecha" className="rs-in" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
                </div>
                <div>
                  <label className="rs-label" htmlFor="hora">Hora</label>
                  <input id="hora" className="rs-in" type="time" value={hora} onChange={(e) => setHora(e.target.value)} />
                </div>
              </div>
              <div>
                <span className="rs-label">Foto de portada</span>
                <div className="rs-foto dropzone" style={raffle?.coverUrl ? { backgroundImage: `url(${raffle.coverUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}>
                  {!raffle?.coverUrl && (
                    <>
                      <Icon name="upload" size={28} />
                      <span>Foto del premio o del sorteo<br />JPG, PNG o WEBP · horizontal 16:9 · máx. 5 MB</span>
                    </>
                  )}
                  <label className="rs-btn rs-btn--secundario rs-btn--sm" style={{ marginTop: 4 }}>
                    {portada.isPending ? 'Subiendo…' : raffle?.coverUrl ? 'Cambiar foto' : 'Elegir archivo'}
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="sr-only"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) subirPortada(f);
                        e.target.value = '';
                      }}
                    />
                  </label>
                </div>
              </div>
            </section>

            {/* 2. Precio y números */}
            <section id="numeros" className="rs-panel panel-pad">
              <div>
                <h2 className="h2">2. Precio y números</h2>
                <p className="rs-help">
                  Define cuántos números se venden y cuánto cuesta cada uno.{bloqueado && ' Después de publicar no se pueden cambiar las cifras ni el precio.'}
                </p>
              </div>
              <div className="grid-auto">
                <div>
                  <label className="rs-label" htmlFor="precio">Precio por número (COP)</label>
                  <input id="precio" className="rs-in rs-mono" inputMode="numeric" value={precio} disabled={bloqueado} onChange={(e) => setPrecio(e.target.value)} />
                </div>
                <div>
                  <label className="rs-label" htmlFor="minimo">Mínimo por compra</label>
                  <input id="minimo" className="rs-in rs-mono" inputMode="numeric" value={minimo} onChange={(e) => setMinimo(e.target.value)} />
                </div>
              </div>
              <fieldset className="bare-fieldset" disabled={bloqueado}>
                <legend className="rs-label">Cantidad de números</legend>
                <div className="chips">
                  {([2, 3, 4] as const).map((c) => (
                    <button
                      key={c}
                      type="button"
                      className="rs-chip"
                      aria-pressed={cifras === c}
                      onClick={() => {
                        setCifras(c);
                        setPremios((cur) => cur.map((p) => (REGLAS[c].some((r) => r.rule === p.rule) ? p : { ...p, rule: REGLAS[c][0].rule })));
                      }}
                    >
                      {c} cifras
                      <span style={{ opacity: 0.7, fontWeight: 500 }}>{'0'.repeat(c)}–{'9'.repeat(c)}</span>
                    </button>
                  ))}
                </div>
              </fieldset>
              <div className="note note--ok" style={{ padding: '14px 16px' }}>
                <Icon name="trend" strokeWidth={2.2} />
                <span>
                  Recaudo total si se venden todos: <b className="rs-mono">{cop(precioNum * total)} · {total.toLocaleString('es-CO')} números</b>
                </span>
              </div>
            </section>

            {/* 3. Premios */}
            <section id="premios" className="rs-panel panel-pad" style={{ gap: 16 }}>
              <div className="seccion-top">
                <div>
                  <h2 className="h2">3. Premios</h2>
                  <p className="rs-help">Cada premio con su monto (o descripción) y cómo se gana. Gana el número exacto; solo cuentan números pagos.</p>
                </div>
                <button type="button" className="rs-btn rs-btn--secundario rs-btn--sm" onClick={() => setPremios((cur) => [...cur, nuevoPremio(REGLAS[cifras][0].rule)])}>
                  <Icon name="plus" size={16} strokeWidth={2.4} />
                  Agregar premio
                </button>
              </div>
              {premios.map((p) => (
                <div key={p.key} className="stack" style={{ gap: 8 }}>
                  <div className="premio-fila">
                    <span aria-hidden="true" className="premio-fila__asa">⋮⋮</span>
                    <input
                      className="rs-in rs-mono"
                      value={p.monto ? cop(soloDigitos(p.monto)) : ''}
                      placeholder="$ monto"
                      onChange={(e) => editarPremio(p.key, 'monto', String(soloDigitos(e.target.value)))}
                      aria-label="Monto del premio"
                    />
                    <select className="rs-in" value={p.rule} onChange={(e) => editarPremio(p.key, 'rule', e.target.value)} aria-label="Cómo se gana">
                      {REGLAS[cifras].map((r) => <option key={r.rule} value={r.rule}>{r.label}</option>)}
                    </select>
                    <button
                      type="button"
                      className="rs-btn rs-btn--fantasma rs-btn--sm"
                      aria-label="Eliminar premio"
                      style={{ color: 'var(--tinta-suave)' }}
                      onClick={() => setPremios((cur) => cur.filter((x) => x.key !== p.key))}
                    >
                      <Icon name="trash" size={18} />
                    </button>
                  </div>
                  <div className="grid-auto" style={{ '--min': '180px', paddingLeft: 28 } as CSSProperties}>
                    {!soloDigitos(p.monto) && (
                      <input className="rs-in" placeholder="Descripción (si no es dinero): Moto Yamaha…" value={p.descripcion} onChange={(e) => editarPremio(p.key, 'descripcion', e.target.value)} aria-label="Descripción del premio" />
                    )}
                    {p.rule === 'custom' && (
                      <input className="rs-in" placeholder="Explica cómo se gana" value={p.custom} onChange={(e) => editarPremio(p.key, 'custom', e.target.value)} aria-label="Regla especial" />
                    )}
                    {ANTICIPADO.includes(p.rule) && (
                      <>
                        <input className="rs-in" placeholder="Lotería del anticipado" value={p.anticipadoLoteria} onChange={(e) => editarPremio(p.key, 'anticipadoLoteria', e.target.value)} aria-label="Lotería del anticipado" />
                        <input className="rs-in" type="time" value={p.anticipadoHora} onChange={(e) => editarPremio(p.key, 'anticipadoHora', e.target.value)} aria-label="Hora del anticipado" />
                      </>
                    )}
                  </div>
                </div>
              ))}
              <div className="grid-auto" style={{ '--min': '220px' } as CSSProperties}>
                <div>
                  <label className="rs-label" htmlFor="cierre">Hora límite de pago (mismo día)</label>
                  <input id="cierre" className="rs-in" type="time" value={cierre} onChange={(e) => setCierre(e.target.value)} />
                  <p className="rs-help">A esa hora se cierra la venta. Déjalo vacío para vender hasta el sorteo.</p>
                </div>
                <div>
                  <label className="rs-label" htmlFor="autorizacion">N.º de autorización (opcional)</label>
                  <input id="autorizacion" className="rs-in rs-mono" value={autorizacion} onChange={(e) => setAutorizacion(e.target.value)} />
                </div>
              </div>
              <div>
                <label className="rs-label" htmlFor="condicion">Condición de participación</label>
                <input
                  id="condicion"
                  className="rs-in"
                  value={condicion}
                  placeholder={cierre ? `Participan los números totalmente pagos antes de las ${cierre}` : 'Participan los números totalmente pagos'}
                  onChange={(e) => setCondicion(e.target.value)}
                />
              </div>
            </section>

            {/* 4. Cómo te pagan */}
            <section id="pago" className="rs-panel panel-pad">
              <div className="seccion-top">
                <div>
                  <h2 className="h2">4. Cómo te pagan</h2>
                  <p className="rs-help">Elige las cuentas que verá el participante, con un botón para copiarlas.</p>
                </div>
                {can('settings.brand') && (
                  <button type="button" className="rs-btn rs-btn--secundario rs-btn--sm" onClick={() => setNuevaCuenta(true)}>
                    <Icon name="plus" size={16} strokeWidth={2.4} />
                    Agregar cuenta
                  </button>
                )}
              </div>
              <div className="chips">
                {(accounts.data ?? []).map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    className="rs-chip"
                    aria-pressed={cuentas.includes(a.id)}
                    onClick={() => setCuentas((cur) => (cur.includes(a.id) ? cur.filter((x) => x !== a.id) : [...cur, a.id]))}
                  >
                    {a.typeLabel} · <span className="rs-mono">{a.keyOrNumber}</span> · {a.holderName}
                  </button>
                ))}
                {accounts.data?.length === 0 && <span className="rs-help">Aún no tienes cuentas. Agrega una para poder publicar.</span>}
              </div>
              {paymentsSettings.data && (
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={paymentsSettings.data.data.requireReceipt}
                    disabled={!can('settings.brand') || exigirComprobante.isPending}
                    onChange={(e) => run(() => exigirComprobante.mutateAsync(e.target.checked))}
                  />
                  <span>
                    <span className="check-row__t">Pedir comprobante de pago</span>
                    <span className="rs-help" style={{ display: 'block', marginTop: 0 }}>
                      El número queda apartado {paymentsSettings.data.data.reservationMinutes} minutos hasta que suban el comprobante. Aplica a todos tus sorteos.
                    </span>
                  </span>
                </label>
              )}
            </section>

            {/* 5. Diseño */}
            <section id="diseno" className="rs-panel panel-pad">
              <div>
                <h2 className="h2">5. Diseño del enlace</h2>
                <p className="rs-help">Personaliza el color del sorteo. El logo y la letra de Rifa Star se mantienen.</p>
              </div>
              <fieldset className="bare-fieldset">
                <legend className="rs-label">Color del sorteo</legend>
                <div className="chips">
                  {ACENTOS.map((a) => (
                    <button key={a.id} type="button" className="rs-chip" aria-pressed={actual.id === a.id} onClick={() => setAcento(a.color)}>
                      <span aria-hidden="true" className="punto-color" style={{ background: a.color }} />
                      {a.nombre}
                    </button>
                  ))}
                </div>
              </fieldset>
              <div>
                <label className="rs-label" htmlFor="enlace">Enlace del sorteo</label>
                <div className="prefixed">
                  <span className="prefixed__pre">{enlaceBase}</span>
                  <input
                    id="enlace"
                    className="prefixed__in"
                    value={slug}
                    disabled={bloqueado}
                    onChange={(e) => {
                      setSlugTocado(true);
                      setSlug(slugify60(e.target.value));
                    }}
                  />
                </div>
              </div>
            </section>
          </div>

          {/* Vista previa */}
          <aside aria-label="Vista previa del enlace" className="split__aside preview">
            <div className="preview__top">
              <span className="eyebrow">Vista previa</span>
              {raffle && raffle.status !== 'draft' && <Link to={`/${org?.slug}/${raffle.slug}`} className="strong-link">Abrir en móvil</Link>}
            </div>
            <div className="rs-oscuro preview__phone" style={previewStyle}>
              <div className="preview__screen">
                <div className="preview__bar">
                  <Logo variante="blanco" height={22} />
                  <span className="rs-badge rs-badge--abierto">Abierto</span>
                </div>
                {raffle?.coverUrl ? (
                  <img src={raffle.coverUrl} alt="" className="rs-foto preview__foto" style={{ objectFit: 'cover' }} />
                ) : (
                  <div className="rs-foto preview__foto">Foto de portada</div>
                )}
                <div className="preview__body">
                  <h3 className="rs-display preview__titulo">{titulo || 'Título del sorteo'}</h3>
                  <p className="preview__meta">{loteria} · {drawIso ? formatDraw(drawIso, tz) : 'Sin fecha'}</p>
                  <div className="preview__precio">
                    <span>Cada número</span>
                    <span className="rs-display">{cop(precioNum)}</span>
                  </div>
                  <div className="rs-progreso">
                    <span style={{ width: `${raffle ? Math.round((raffle.progress.paid / raffle.totalNumbers) * 100) : 0}%` }} />
                  </div>
                  <div className="preview__nums">
                    {Array.from({ length: 15 }, (_, i) => (
                      <span key={i} className="rs-num preview__num" aria-pressed={i === 3 || i === 10}>
                        {pad(i, cifras)}
                      </span>
                    ))}
                  </div>
                  <span className="rs-btn rs-btn--primario preview__cta">Elegir mis números</span>
                </div>
              </div>
            </div>
          </aside>
        </div>
      </fieldset>

      {nuevaCuenta && (
        <NuevaCuenta
          onClose={() => setNuevaCuenta(false)}
          onCreated={(a) => {
            setCuentas((cur) => [...cur, a.id]);
            setNuevaCuenta(false);
          }}
        />
      )}
      {cancelar && raffle && (
        <CancelarSorteo
          onClose={() => setCancelar(false)}
          onConfirm={(reason) =>
            run(async () => {
              await accionSorteo.mutateAsync({ path: 'cancel', body: { reason } });
              setCancelar(false);
              setOk('Sorteo cancelado. Avisamos por WhatsApp a quienes pagaron.');
            })
          }
        />
      )}
    </div>
  );
}

export function NuevaCuenta({ onClose, onCreated }: { onClose: () => void; onCreated: (a: PaymentAccount) => void }) {
  const [type, setType] = useState<PaymentAccount['type']>('bre_b');
  const [key, setKey] = useState('');
  const [holder, setHolder] = useState('');
  const [bank, setBank] = useState('');
  const [kind, setKind] = useState('ahorros');
  const crear = useOrgMutation<void, PaymentAccount>((_v, req) =>
    req<PaymentAccount>('/v1/payment-accounts', {
      body: { type, keyOrNumber: key, holderName: holder, ...(type === 'bank_transfer' && { bankName: bank, accountKind: kind }) },
    }),
  );
  return (
    <Modal
      title="Agregar cuenta de pago"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="rs-btn rs-btn--secundario" onClick={onClose}>Cancelar</button>
          <button type="button" className="rs-btn rs-btn--primario" disabled={crear.isPending} onClick={() => crear.mutateAsync().then(onCreated).catch(() => undefined)}>
            Guardar cuenta
          </button>
        </>
      }
    >
      <div className="chips">
        {TIPOS_CUENTA.map((t) => (
          <button key={t.id} type="button" className="rs-chip" aria-pressed={type === t.id} onClick={() => setType(t.id)}>{t.label}</button>
        ))}
      </div>
      <div>
        <label className="rs-label" htmlFor="ck">{type === 'bank_transfer' ? 'Número de cuenta' : 'Llave / número'}</label>
        <input id="ck" className="rs-in rs-mono" value={key} onChange={(e) => setKey(e.target.value)} />
      </div>
      <div>
        <label className="rs-label" htmlFor="ch">Titular</label>
        <input id="ch" className="rs-in" value={holder} onChange={(e) => setHolder(e.target.value)} />
      </div>
      {type === 'bank_transfer' && (
        <div className="grid-auto">
          <div>
            <label className="rs-label" htmlFor="cb">Banco</label>
            <input id="cb" className="rs-in" value={bank} onChange={(e) => setBank(e.target.value)} />
          </div>
          <div>
            <label className="rs-label" htmlFor="ct">Tipo</label>
            <select id="ct" className="rs-in" value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="ahorros">Ahorros</option>
              <option value="corriente">Corriente</option>
            </select>
          </div>
        </div>
      )}
      <ErrorNote error={crear.error} />
    </Modal>
  );
}

function CancelarSorteo({ onClose, onConfirm }: { onClose: () => void; onConfirm: (reason: string) => void }) {
  const [reason, setReason] = useState('');
  return (
    <Modal
      title="Cancelar sorteo"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="rs-btn rs-btn--secundario" onClick={onClose}>Volver</button>
          <button type="button" className="rs-btn rs-btn--urgente" disabled={reason.trim().length < 3} onClick={() => onConfirm(reason.trim())}>
            Cancelar sorteo
          </button>
        </>
      }
    >
      <p className="rs-help">Los apartados se liberan. Lo pagado se conserva y el reembolso lo haces tú; avisamos por WhatsApp a quienes pagaron.</p>
      <div>
        <label className="rs-label" htmlFor="motivo">Motivo</label>
        <input id="motivo" className="rs-in" value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
    </Modal>
  );
}
