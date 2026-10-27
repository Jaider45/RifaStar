import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { uploadToStorage } from '@/api/client';
import { useCan, useOrgMutation, useOrgProfile, useOrgQuery } from '@/api/hooks';
import {
  DEFAULT_PAGE,
  type Digits,
  type DrawInfo,
  type ExtraDigitsPosition,
  type ExtraDigitsSource,
  type NumberSelection,
  type PageConfig,
  type PaymentAccount,
  type PrizeRule,
  type Raffle,
  type Upload,
} from '@/api/types';
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
const REGLAS: Record<Digits, { rule: PrizeRule; label: string }[]> = {
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
  5: [
    { rule: 'full_number', label: 'Número completo (5 cifras)' },
    { rule: 'custom', label: 'Regla especial' },
  ],
  6: [
    { rule: 'full_number', label: 'Número completo (6 cifras)' },
    { rule: 'custom', label: 'Regla especial' },
  ],
};
const ANTICIPADO: PrizeRule[] = ['anticipated_last_two', 'anticipated_full_number'];
const CIFRAS: Digits[] = [2, 3, 4, 5, 6];
/** Sin código de LoteríaYa: no se consulta el resultado automáticamente. */
const PROPIO = '';

/** «4058 · serie 127 → 40587»: ejemplo de cómo se arma el número de 5 o 6 cifras. */
function ejemploNumero(cifras: Digits, fuente: ExtraDigitsSource, posicion: ExtraDigitsPosition): string {
  const extra = fuente === 'fifth_digit' ? '3' : cifras === 6 ? '27' : '7';
  const fuenteTxt = fuente === 'fifth_digit' ? 'quinta cifra 3' : 'serie 127';
  return `Resultado 4058 · ${fuenteTxt} → ${posicion === 'start' ? extra + '4058' : '4058' + extra}`;
}

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
  /** Código de LoteríaYa del anticipado (`antioquenita-tarde`) o vacío si es otra. */
  anticipadoCodigo: string;
  anticipadoHora: string;
  imageKey: string | null;
  imageUrl: string | null;
}

let seq = 0;
const nuevoPremio = (rule: PrizeRule, monto = ''): PremioForm => ({
  key: ++seq,
  monto,
  descripcion: '',
  rule,
  custom: '',
  anticipadoLoteria: 'Antioqueñita Tarde',
  anticipadoCodigo: 'antioquenita-tarde',
  anticipadoHora: '16:00',
  imageKey: null,
  imageUrl: null,
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
  const catalogo = useOrgQuery<DrawInfo[]>('/v1/lotteries', { staleTime: 3_600_000 });
  const loteriasCat = (catalogo.data ?? []).filter((d) => d.category === 'loteria');
  const chancesCat = (catalogo.data ?? []).filter((d) => d.category === 'chance');

  const [paso, setPaso] = useState('info');
  const [titulo, setTitulo] = useState('');
  const [loteria, setLoteria] = useState('Lotería de Boyacá');
  const [loteriaCodigo, setLoteriaCodigo] = useState('loteria-de-boyaca');
  const [fecha, setFecha] = useState(proximoSabado);
  const [hora, setHora] = useState('22:40');
  const [cierre, setCierre] = useState('15:30');
  const [precio, setPrecio] = useState('6000');
  const [minimo, setMinimo] = useState('1');
  const [unidad, setUnidad] = useState('número');
  const [unidades, setUnidades] = useState('números');
  const [cifras, setCifras] = useState<Digits>(2);
  const [seleccion, setSeleccion] = useState<NumberSelection>('choose');
  const [fuenteExtra, setFuenteExtra] = useState<ExtraDigitsSource>('series');
  const [posicionExtra, setPosicionExtra] = useState<ExtraDigitsPosition>('end');
  const [pagina, setPagina] = useState<PageConfig>(DEFAULT_PAGE);
  const [galeria, setGaleria] = useState<{ key: string; url: string }[]>([]);
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
    setLoteriaCodigo(raffle.lotteryDrawCode ?? PROPIO);
    setFecha(draw.date);
    setHora(draw.time);
    setCierre(raffle.salesCloseAt ? isoToZoned(raffle.salesCloseAt, tz).time : '');
    setPrecio(String(raffle.pricePerNumber));
    setMinimo(String(raffle.minPerOrder));
    setUnidad(raffle.unitLabel);
    setUnidades(raffle.unitLabelPlural);
    setCifras(raffle.digits);
    setSeleccion(raffle.numberSelection);
    setFuenteExtra(raffle.extraDigitsSource ?? 'series');
    setPosicionExtra(raffle.extraDigitsPosition);
    setPagina({ ...DEFAULT_PAGE, ...raffle.pageConfig, show: { ...DEFAULT_PAGE.show, ...raffle.pageConfig?.show } });
    setGaleria(raffle.gallery ?? []);
    setPremios(
      raffle.prizes.map((p) => ({
        ...nuevoPremio(p.rule, p.amountCop ? String(p.amountCop) : ''),
        descripcion: p.description ?? '',
        custom: p.customRuleText ?? '',
        anticipadoLoteria: p.anticipatedLottery ?? 'Antioqueñita',
        anticipadoCodigo: p.anticipatedDrawCode ?? '',
        anticipadoHora: p.anticipatedDrawAt ? isoToZoned(p.anticipatedDrawAt, tz).time : '16:00',
        imageKey: p.imageKey ?? null,
        imageUrl: p.imageUrl ?? null,
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

  const grande = cifras >= 5;
  const body = useMemo(() => {
    const prizes = premios.map((p) => ({
      ...(soloDigitos(p.monto) > 0 && { amountCop: soloDigitos(p.monto) }),
      ...(p.descripcion.trim() && { description: p.descripcion.trim() }),
      rule: p.rule,
      ...(p.rule === 'custom' && { customRuleText: p.custom.trim() }),
      ...(ANTICIPADO.includes(p.rule) && {
        anticipatedLottery: p.anticipadoLoteria.trim(),
        anticipatedDrawCode: p.anticipadoCodigo || null,
        anticipatedDrawAt: zonedToIso(fecha, p.anticipadoHora, tz) ?? undefined,
      }),
      imageKey: p.imageKey,
    }));
    const faq = pagina.faq.filter((f) => f.q.trim() && f.a.trim());
    return {
      title: titulo.trim(),
      lottery: loteria,
      lotteryDrawCode: loteriaCodigo || null,
      drawAt: drawIso,
      salesCloseAt: cierre ? zonedToIso(fecha, cierre, tz) : null,
      pricePerNumber: precioNum,
      digits: cifras,
      minPerOrder: Math.max(1, soloDigitos(minimo)),
      unitLabel: unidad.trim().toLowerCase(),
      unitLabelPlural: unidades.trim().toLowerCase(),
      numberSelection: seleccion,
      extraDigitsSource: grande ? (cifras === 6 ? 'series' : fuenteExtra) : null,
      extraDigitsPosition: posicionExtra,
      accentColor: acento,
      conditionText: condicion.trim() || null,
      authorizationNumber: autorizacion.trim() || null,
      pageConfig: { ...pagina, description: pagina.description?.trim() || null, faq },
      galleryKeys: galeria.map((g) => g.key),
      paymentAccountIds: cuentas,
      ...(slug && { slug }),
      prizes,
    };
  }, [titulo, loteria, loteriaCodigo, drawIso, cierre, fecha, tz, precioNum, cifras, grande, minimo, unidad, unidades, seleccion, fuenteExtra, posicionExtra, acento, condicion, autorizacion, pagina, galeria, cuentas, slug, premios]);

  const guardar = useOrgMutation<void, Raffle>(async (_v, req) => {
    if (!raffle) return req<Raffle>('/v1/raffles', { body });
    const { prizes, ...rest } = body;
    const patch: Record<string, unknown> = { ...rest };
    if (bloqueado) {
      // Lo que define cómo se reparten y arman los números no cambia después de vender.
      for (const f of ['digits', 'pricePerNumber', 'slug', 'numberSelection', 'extraDigitsSource', 'extraDigitsPosition', 'minPerOrder']) delete patch[f];
    }
    await req<Raffle>(`/v1/raffles/${raffle.id}`, { method: 'PATCH', body: patch });
    return req<Raffle>(`/v1/raffles/${raffle.id}/prizes`, { method: 'PUT', body: { prizes } });
  });

  /** Sube una foto de la galería o de un premio (guarda el sorteo primero si es nuevo). */
  const media = useOrgMutation<{ rid: string; kind: 'gallery' | 'prize'; file: File }, { key: string; url: string }>(async ({ rid, kind, file }, req) => {
    const up = await req<Upload>(`/v1/raffles/${rid}/media/${kind}`, { body: { contentType: file.type, size: file.size } });
    await uploadToStorage(up, file);
    return req<{ key: string; url: string }>(`/v1/raffles/${rid}/media/${kind}/confirm`, { body: { key: up.key } });
  });
  const subirMedia = (kind: 'gallery' | 'prize', file: File, onDone: (m: { key: string; url: string }) => void) =>
    run(async () => {
      const rid = raffle?.id ?? (await guardar.mutateAsync()).id;
      onDone(await media.mutateAsync({ rid, kind, file }));
      if (!raffle) navigate(`/admin/sorteos/${rid}`, { replace: true });
      setOk(kind === 'gallery' ? 'Foto agregada. Guarda los cambios para publicarla.' : 'Foto del premio lista. Guarda los cambios.');
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

  const ocupado = guardar.isPending || publicar.isPending || portada.isPending || media.isPending;
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
                  <select
                    id="loteria"
                    className="rs-in"
                    value={loteriaCodigo || `nombre:${loteria}`}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v.startsWith('nombre:')) {
                        setLoteriaCodigo(PROPIO);
                        setLoteria(v.slice(7));
                      } else {
                        setLoteriaCodigo(v);
                        setLoteria(loteriasCat.find((d) => d.code === v)?.name ?? v);
                      }
                    }}
                  >
                    {loteriasCat.length > 0
                      ? loteriasCat.map((d) => <option key={d.code} value={d.code}>{d.name}</option>)
                      : LOTERIAS.filter((l) => l !== 'Sorteo propio en vivo').map((l) => <option key={l} value={`nombre:${l}`}>{l}</option>)}
                    {!loteriaCodigo && !LOTERIAS.includes(loteria) && <option value={`nombre:${loteria}`}>{loteria}</option>}
                    <option value="nombre:Sorteo propio en vivo">Sorteo propio en vivo</option>
                  </select>
                  <p className="rs-help">
                    {loteriaCodigo ? 'Te avisamos el resultado apenas salga (LoteríaYa). Tú lo confirmas e ingresas.' : 'Sin consulta automática: ingresas el resultado a mano.'}
                  </p>
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
                  <label className="rs-label" htmlFor="minimo">Compra mínima por participante</label>
                  <input id="minimo" className="rs-in rs-mono" inputMode="numeric" value={minimo} disabled={bloqueado} onChange={(e) => setMinimo(e.target.value)} />
                  <p className="rs-help">Cuenta lo que ya compró en este sorteo: si el mínimo es 3 y ya tiene 3, puede sumar de a uno.</p>
                </div>
                <div>
                  <label className="rs-label" htmlFor="unidad">Cómo llamas a cada número</label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input id="unidad" className="rs-in" aria-label="Nombre en singular" placeholder="boleta" value={unidad} onChange={(e) => setUnidad(e.target.value)} />
                    <input className="rs-in" aria-label="Nombre en plural" placeholder="boletas" value={unidades} onChange={(e) => setUnidades(e.target.value)} />
                  </div>
                  <p className="rs-help">Singular y plural: número, boleta, puesto, cupón… Sale en la página pública y en el comprobante.</p>
                </div>
              </div>
              <fieldset className="bare-fieldset" disabled={bloqueado}>
                <legend className="rs-label">Cantidad de números</legend>
                <div className="chips">
                  {CIFRAS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      className="rs-chip"
                      aria-pressed={cifras === c}
                      onClick={() => {
                        setCifras(c);
                        if (c >= 5) setSeleccion('random');
                        if (c === 6) setFuenteExtra('series');
                        setPremios((cur) => cur.map((p) => (REGLAS[c].some((r) => r.rule === p.rule) ? p : { ...p, rule: REGLAS[c][0].rule })));
                      }}
                    >
                      {c} cifras
                      <span style={{ opacity: 0.7, fontWeight: 500 }}>{(10 ** c).toLocaleString('es-CO')}</span>
                    </button>
                  ))}
                </div>
              </fieldset>
              {grande && (
                <fieldset className="bare-fieldset rs-panel cifras-extra" disabled={bloqueado}>
                  <legend className="rs-label">Cómo se arma el número ganador</legend>
                  <p className="rs-help" style={{ marginTop: 0 }}>
                    La lotería da 4 cifras. {cifras === 5 ? 'La quinta' : 'Las otras dos'} sale{cifras === 6 ? 'n' : ''} de:
                  </p>
                  <div className="chips">
                    <button type="button" className="rs-chip" aria-pressed={fuenteExtra === 'series'} onClick={() => setFuenteExtra('series')}>
                      {cifras === 5 ? 'Última cifra de la serie' : 'Dos últimas cifras de la serie'}
                    </button>
                    {cifras === 5 && (
                      <button type="button" className="rs-chip" aria-pressed={fuenteExtra === 'fifth_digit'} onClick={() => setFuenteExtra('fifth_digit')}>
                        Quinta cifra del chance
                      </button>
                    )}
                  </div>
                  <div className="chips">
                    <button type="button" className="rs-chip" aria-pressed={posicionExtra === 'end'} onClick={() => setPosicionExtra('end')}>Al final</button>
                    <button type="button" className="rs-chip" aria-pressed={posicionExtra === 'start'} onClick={() => setPosicionExtra('start')}>Al inicio</button>
                  </div>
                  <p className="note note--fondo rs-mono">{ejemploNumero(cifras, cifras === 6 ? 'series' : fuenteExtra, posicionExtra)}</p>
                </fieldset>
              )}
              <fieldset className="bare-fieldset" disabled={bloqueado}>
                <legend className="rs-label">¿Quién elige los números?</legend>
                <div className="chips">
                  <button type="button" className="rs-chip" aria-pressed={seleccion === 'choose'} onClick={() => setSeleccion('choose')}>El participante los elige</button>
                  <button type="button" className="rs-chip" aria-pressed={seleccion === 'random'} onClick={() => setSeleccion('random')}>Siempre al azar</button>
                </div>
                <p className="rs-help">
                  {seleccion === 'random'
                    ? 'El participante solo dice cuántos números quiere y el sistema se los asigna al azar.'
                    : grande
                      ? 'Con tantos números, el participante busca el suyo o navega por bloques de 1.000.'
                      : 'El participante toca los números libres en la grilla.'}
                </p>
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
                        {chancesCat.length > 0 ? (
                          <select
                            className="rs-in"
                            aria-label="Lotería del anticipado"
                            value={p.anticipadoCodigo || 'otra'}
                            onChange={(e) => {
                              const v = e.target.value;
                              const d = chancesCat.find((x) => x.code === v);
                              setPremios((cur) =>
                                cur.map((x) => (x.key === p.key ? { ...x, anticipadoCodigo: d ? d.code : '', anticipadoLoteria: d ? d.name : x.anticipadoLoteria } : x)),
                              );
                            }}
                          >
                            {chancesCat.map((d) => <option key={d.code} value={d.code}>{d.name}</option>)}
                            <option value="otra">Otra (escribir)</option>
                          </select>
                        ) : null}
                        {(!p.anticipadoCodigo || chancesCat.length === 0) && (
                          <input className="rs-in" placeholder="Lotería del anticipado" value={p.anticipadoLoteria} onChange={(e) => editarPremio(p.key, 'anticipadoLoteria', e.target.value)} aria-label="Nombre de la lotería del anticipado" />
                        )}
                        <input className="rs-in" type="time" value={p.anticipadoHora} onChange={(e) => editarPremio(p.key, 'anticipadoHora', e.target.value)} aria-label="Hora del anticipado" />
                      </>
                    )}
                    <div className="premio-foto">
                      {p.imageUrl && <img src={p.imageUrl} alt="" className="premio-foto__img" />}
                      <label className="rs-btn rs-btn--secundario rs-btn--sm">
                        <Icon name="image" size={16} />
                        {p.imageUrl ? 'Cambiar foto' : 'Foto del premio'}
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          className="sr-only"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) subirMedia('prize', f, (m) => setPremios((cur) => cur.map((x) => (x.key === p.key ? { ...x, imageKey: m.key, imageUrl: m.url } : x))));
                            e.target.value = '';
                          }}
                        />
                      </label>
                      {p.imageUrl && (
                        <button type="button" className="rs-btn rs-btn--fantasma rs-btn--sm" onClick={() => setPremios((cur) => cur.map((x) => (x.key === p.key ? { ...x, imageKey: null, imageUrl: null } : x)))}>
                          Quitar
                        </button>
                      )}
                    </div>
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
                <p className="rs-help">Personaliza la página del sorteo. El logo y la letra de Rifa Star se mantienen.</p>
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
                  <label className="rs-chip" aria-pressed={actual.id === 'libre'}>
                    <input type="color" className="color-libre" value={actual.color} onChange={(e) => setAcento(e.target.value)} aria-label="Color propio" />
                    Color propio
                  </label>
                </div>
                <p className="rs-help">El texto encima del color (negro o blanco) se elige solo para que siempre se lea.</p>
              </fieldset>
              <fieldset className="bare-fieldset">
                <legend className="rs-label">Tema de la página</legend>
                <div className="chips">
                  <button type="button" className="rs-chip" aria-pressed={pagina.theme === 'dark'} onClick={() => setPagina((p) => ({ ...p, theme: 'dark' }))}>Oscuro (recomendado)</button>
                  <button type="button" className="rs-chip" aria-pressed={pagina.theme === 'light'} onClick={() => setPagina((p) => ({ ...p, theme: 'light' }))}>Claro</button>
                </div>
              </fieldset>
              <div>
                <label className="rs-label" htmlFor="descripcion">Descripción del sorteo (opcional)</label>
                <textarea
                  id="descripcion"
                  className="rs-in"
                  maxLength={2000}
                  rows={5}
                  value={pagina.description ?? ''}
                  placeholder={'**Una moto 0 km** para estrenar.\n\n- Papeles al día\n- Entrega en Medellín'}
                  onChange={(e) => setPagina((p) => ({ ...p, description: e.target.value }))}
                />
                <p className="rs-help">**negrita**, *cursiva*, listas con «- » y enlaces [texto](https://…). {(pagina.description ?? '').length} / 2000</p>
              </div>
              <div className="stack" style={{ gap: 10 }}>
                <div className="seccion-top">
                  <span className="rs-label" style={{ margin: 0 }}>Preguntas frecuentes</span>
                  <button
                    type="button"
                    className="rs-btn rs-btn--secundario rs-btn--sm"
                    disabled={pagina.faq.length >= 12}
                    onClick={() => setPagina((p) => ({ ...p, faq: [...p.faq, { q: '', a: '' }] }))}
                  >
                    <Icon name="plus" size={16} strokeWidth={2.4} />
                    Agregar pregunta
                  </button>
                </div>
                {pagina.faq.map((f, i) => (
                  <div key={i} className="faq-fila">
                    <input
                      className="rs-in"
                      placeholder="¿Cuándo entregan el premio?"
                      maxLength={150}
                      value={f.q}
                      aria-label={`Pregunta ${i + 1}`}
                      onChange={(e) => setPagina((p) => ({ ...p, faq: p.faq.map((x, k) => (k === i ? { ...x, q: e.target.value } : x)) }))}
                    />
                    <textarea
                      className="rs-in"
                      rows={2}
                      maxLength={600}
                      placeholder="Respuesta"
                      value={f.a}
                      aria-label={`Respuesta ${i + 1}`}
                      onChange={(e) => setPagina((p) => ({ ...p, faq: p.faq.map((x, k) => (k === i ? { ...x, a: e.target.value } : x)) }))}
                    />
                    <button type="button" className="rs-btn rs-btn--fantasma rs-btn--sm" aria-label={`Quitar pregunta ${i + 1}`} onClick={() => setPagina((p) => ({ ...p, faq: p.faq.filter((_, k) => k !== i) }))}>
                      <Icon name="trash" size={18} />
                    </button>
                  </div>
                ))}
              </div>
              <fieldset className="bare-fieldset">
                <legend className="rs-label">Qué se muestra en la página</legend>
                <div className="secciones-visibles">
                  {(
                    [
                      ['countdown', 'Cuenta regresiva'],
                      ['progress', 'Barra de avance'],
                      ['remaining', '«Quedan X números»'],
                      ['organizer', 'Organizador verificado'],
                      ['ranking', 'Enlace al ranking'],
                      ['social', 'Redes del organizador'],
                    ] as const
                  ).map(([k, label]) => (
                    <label key={k} className="check-row">
                      <input type="checkbox" checked={pagina.show[k]} onChange={(e) => setPagina((p) => ({ ...p, show: { ...p.show, [k]: e.target.checked } }))} />
                      <span className="check-row__t" style={{ font: '600 14px/20px var(--font-sans)' }}>{label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="stack" style={{ gap: 10 }}>
                <span className="rs-label" style={{ margin: 0 }}>Galería del premio (hasta 6 fotos)</span>
                <div className="galeria-admin">
                  {galeria.map((g, i) => (
                    <div key={g.key} className="galeria-admin__item">
                      <img src={g.url} alt={`Foto ${i + 1}`} />
                      <button type="button" className="rs-btn rs-btn--secundario rs-btn--sm" aria-label={`Quitar foto ${i + 1}`} onClick={() => setGaleria((cur) => cur.filter((x) => x.key !== g.key))}>
                        <Icon name="trash" size={16} />
                      </button>
                    </div>
                  ))}
                  {galeria.length < 6 && (
                    <label className="rs-foto galeria-admin__add">
                      <Icon name="plus" size={22} />
                      Agregar foto
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        className="sr-only"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) subirMedia('gallery', f, (m) => setGaleria((cur) => [...cur, m]));
                          e.target.value = '';
                        }}
                      />
                    </label>
                  )}
                </div>
              </div>
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
              <div className={`preview__screen ${pagina.theme === 'light' ? 'rs-claro' : ''}`}>
                <div className="preview__bar">
                  <Logo variante={pagina.theme === 'light' ? 'negro' : 'blanco'} height={22} />
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
                  {seleccion === 'random' ? (
                    <div className="preview__azar">
                      <Icon name="dice" size={18} />
                      <span>Números al azar{Math.max(1, soloDigitos(minimo)) > 1 ? ` · mínimo ${Math.max(1, soloDigitos(minimo))}` : ''}</span>
                    </div>
                  ) : (
                    <div className="preview__nums" style={{ gridTemplateColumns: `repeat(${cifras >= 5 ? 3 : 5}, minmax(0, 1fr))` }}>
                      {Array.from({ length: cifras >= 5 ? 9 : 15 }, (_, i) => (
                        <span key={i} className="rs-num preview__num" aria-pressed={i === 3 || i === 7}>
                          {pad(cifras >= 5 ? 40580 + i : i, cifras)}
                        </span>
                      ))}
                    </div>
                  )}
                  <span className="rs-btn rs-btn--primario preview__cta">{seleccion === 'random' ? 'Comprar números' : 'Elegir mis números'}</span>
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
