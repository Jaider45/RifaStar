import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import QRCode from 'qrcode';
import { uploadToStorage } from '@/api/client';
import { useSession } from '@/api/session';
import { useCan, useOrgMutation, useOrgProfile, useOrgQuery } from '@/api/hooks';
import type { OrgProfile, PaymentAccount, Upload } from '@/api/types';
import { Badge } from '@/components/Badge';
import { PageHeader } from '@/components/PageHeader';
import { Empty, ErrorNote, Loading, Modal, OkNote } from '@/components/ui';
import { ACENTOS } from '@/lib/acentos';
import { cop } from '@/lib/format';
import { formatPhone } from '@/lib/phone';
import { formatDay, timeAgo } from '@/lib/time';
import { NuevaCuenta } from './Constructor';
import './Ajustes.css';

const TABS = [
  { id: 'negocio', nombre: 'Negocio y marca' },
  { id: 'seguridad', nombre: 'Seguridad' },
  { id: 'pagos', nombre: 'Pagos' },
  { id: 'comprobantes', nombre: 'Comprobantes' },
  { id: 'ranking', nombre: 'Ranking' },
  { id: 'equipo', nombre: 'Equipo y roles' },
  { id: 'notif', nombre: 'Notificaciones' },
  { id: 'plan', nombre: 'Plan y facturación' },
] as const;
type TabId = (typeof TABS)[number]['id'];

interface Section<T> { revision: number; data: T }

interface Branding {
  hideRifaStarBadge: boolean;
  instagramUrl: string | null;
  facebookUrl: string | null;
  tiktokUrl: string | null;
}

function Ajuste({ t, d, children, style }: { t: string; d: string; children?: ReactNode; style?: CSSProperties }) {
  return (
    <div className="setting" style={style}>
      <div>
        <div className="setting__t">{t}</div>
        <div className="setting__d">{d}</div>
      </div>
      {children}
    </div>
  );
}

function Switch({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return <input type="checkbox" className="switch" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} aria-label={label} />;
}

function Acciones({ dirty, saving, onReset, onSave }: { dirty: boolean; saving: boolean; onReset: () => void; onSave: () => void }) {
  return (
    <div className="ajustes-acciones">
      <button type="button" className="rs-btn rs-btn--secundario" disabled={!dirty || saving} onClick={onReset}>Descartar</button>
      <button type="button" className="rs-btn rs-btn--primario" disabled={!dirty || saving} onClick={onSave}>{saving ? 'Guardando…' : 'Guardar cambios'}</button>
    </div>
  );
}

/** Estado editable de una sección de ajustes con su revisión (control de concurrencia). */
function useSectionForm<T>(section: string) {
  const q = useOrgQuery<Section<T>>(`/v1/settings/${section}`);
  const [draft, setDraft] = useState<T | null>(null);
  useEffect(() => {
    if (q.data) setDraft(q.data.data);
  }, [q.data]);
  const save = useOrgMutation<void>((_v, req) => req(`/v1/settings/${section}`, { method: 'PUT', body: { revision: q.data!.revision, data: draft } }).then(() => undefined));
  const dirty = Boolean(q.data && draft && JSON.stringify(q.data.data) !== JSON.stringify(draft));
  return { q, draft, setDraft, save, dirty, reset: () => setDraft(q.data?.data ?? null) };
}

export default function Ajustes() {
  const [params, setParams] = useSearchParams();
  const tab = (TABS.some((t) => t.id === params.get('tab')) ? params.get('tab') : 'negocio') as TabId;

  return (
    <>
      <PageHeader title="Ajustes" sub="Lo que configures aquí se aplica a todos tus sorteos y enlaces públicos." />
      <div className="split split--24">
        <div role="tablist" aria-orientation="vertical" aria-label="Secciones de ajustes" className="ajustes-tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              id={`tab-${t.id}`}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              aria-controls={`panel-${t.id}`}
              className="ajustes-tab"
              onClick={() => setParams({ tab: t.id })}
            >
              {t.nombre}
            </button>
          ))}
        </div>
        <div className="split__main" role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
          {tab === 'negocio' && <Negocio />}
          {tab === 'seguridad' && <Seguridad />}
          {tab === 'pagos' && <Pagos />}
          {tab === 'comprobantes' && <ComprobantesAjustes />}
          {tab === 'ranking' && <RankingAjustes />}
          {tab === 'equipo' && <Equipo />}
          {tab === 'notif' && <Notificaciones />}
          {tab === 'plan' && <Plan />}
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Negocio y marca
// ---------------------------------------------------------------------------

const ZONAS = ['America/Bogota', 'America/Mexico_City', 'America/Lima', 'America/Guayaquil', 'America/Caracas', 'America/Panama', 'America/Santiago', 'America/Argentina/Buenos_Aires', 'Europe/Madrid'];

function Negocio() {
  const can = useCan();
  const { data: org } = useOrgProfile();
  const branding = useSectionForm<Branding>('branding');
  const [form, setForm] = useState<Pick<OrgProfile, 'name' | 'supportWhatsapp' | 'defaultAccentColor' | 'timezone'> | null>(null);
  const [dominio, setDominio] = useState('');
  const [ok, setOk] = useState<string | null>(null);
  useEffect(() => {
    if (org) {
      setForm({ name: org.name, supportWhatsapp: org.supportWhatsapp ? formatPhone(org.supportWhatsapp) : '', defaultAccentColor: org.defaultAccentColor, timezone: org.timezone });
      setDominio(org.customDomain ?? '');
    }
  }, [org]);
  const guardar = useOrgMutation<void>((_v, req) =>
    req('/v1/organization', { method: 'PATCH', body: { ...form, supportWhatsapp: form?.supportWhatsapp?.trim() || null } }).then(() => undefined),
  );
  const logo = useOrgMutation<File>(async (file, req) => {
    const up = await req<Upload>('/v1/organization/logo', { body: { contentType: file.type, size: file.size } });
    await uploadToStorage(up, file);
    await req('/v1/organization/logo/confirm', { body: { key: up.key } });
  });
  const guardarDominio = useOrgMutation<void>((_v, req) => req('/v1/organization/custom-domain', { method: 'PUT', body: { domain: dominio.trim() || null } }).then(() => undefined));

  if (!org || !form) return <Loading />;
  const editable = can('settings.brand');
  const dirty = form.name !== org.name || (form.supportWhatsapp ?? '') !== (org.supportWhatsapp ? formatPhone(org.supportWhatsapp) : '') || form.defaultAccentColor !== org.defaultAccentColor || form.timezone !== org.timezone;

  return (
    <section className="rs-panel panel-pad">
      <h2 className="h2 h2--lg">Negocio y marca</h2>
      {ok && <OkNote>{ok}</OkNote>}
      <ErrorNote error={guardar.error ?? logo.error ?? guardarDominio.error ?? branding.save.error} />
      <fieldset className="bare-fieldset stack" style={{ gap: 18 }} disabled={!editable}>
        <div className="grid-auto" style={{ '--min': '240px' } as CSSProperties}>
          <div>
            <label className="rs-label" htmlFor="nnombre">Nombre público</label>
            <input id="nnombre" className="rs-in" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <label className="rs-label" htmlFor="nwa">WhatsApp de soporte</label>
            <input id="nwa" className="rs-in rs-mono" value={form.supportWhatsapp ?? ''} placeholder="+57 316 811 0777" onChange={(e) => setForm({ ...form, supportWhatsapp: e.target.value })} />
          </div>
          <div>
            <label className="rs-label" htmlFor="ntz">Zona horaria</label>
            <select id="ntz" className="rs-in" value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })}>
              {[...new Set([form.timezone, ...ZONAS])].map((z) => <option key={z}>{z}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className="rs-label" htmlFor="nslug">Tu dirección</label>
          <div className="prefixed">
            <span className="prefixed__pre">rifastar.co/</span>
            <input id="nslug" className="prefixed__in" value={org.slug} readOnly />
          </div>
          <p className="rs-help">Para cambiarla escríbele a soporte de Rifa Star (los enlaces ya compartidos dejarían de funcionar).</p>
        </div>
        <div className="logo-org">
          {org.logoUrl ? <img src={org.logoUrl} alt="Logo" className="rs-foto logo-org__foto" style={{ objectFit: 'cover' }} /> : <div className="rs-foto logo-org__foto">Logo</div>}
          <div>
            <div className="setting__t">Logo del organizador</div>
            <div className="setting__d">Aparece junto al de Rifa Star en tus enlaces. PNG o JPG cuadrado, máx. 2 MB.</div>
          </div>
          <label className="rs-btn rs-btn--secundario rs-btn--sm" style={{ marginLeft: 'auto' }}>
            {logo.isPending ? 'Subiendo…' : 'Subir logo'}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) logo.mutateAsync(f).then(() => setOk('Logo actualizado.')).catch(() => undefined);
                e.target.value = '';
              }}
            />
          </label>
        </div>
        <fieldset className="bare-fieldset">
          <legend className="rs-label">Color por defecto de los sorteos</legend>
          <div className="chips">
            {ACENTOS.map((a) => (
              <button key={a.id} type="button" className="rs-chip" aria-pressed={form.defaultAccentColor.toLowerCase() === a.color} onClick={() => setForm({ ...form, defaultAccentColor: a.color })}>
                <span aria-hidden="true" style={{ width: 16, height: 16, borderRadius: '50%', background: a.color }} />
                {a.nombre}
              </button>
            ))}
          </div>
        </fieldset>
        <Acciones
          dirty={dirty}
          saving={guardar.isPending}
          onReset={() => setForm({ name: org.name, supportWhatsapp: org.supportWhatsapp ? formatPhone(org.supportWhatsapp) : '', defaultAccentColor: org.defaultAccentColor, timezone: org.timezone })}
          onSave={() => guardar.mutateAsync().then(() => setOk('Cambios guardados.')).catch(() => undefined)}
        />
        <div className="setting" style={{ borderTop: '1px solid var(--linea)' }}>
          <div style={{ flex: 1 }}>
            <div className="setting__t">Dominio propio (plan Agencia)</div>
            <div className="setting__d">
              {org.customDomain
                ? org.customDomainVerifiedAt
                  ? `Activo: ${org.customDomain}`
                  : `Pendiente de verificación: apunta un CNAME de ${org.customDomain} a rifastar.co y avísale a soporte.`
                : 'Usa tu propio dominio, por ejemplo rifas.tunegocio.com.'}
            </div>
          </div>
          <input className="rs-in" style={{ width: 220 }} placeholder="rifas.tunegocio.com" aria-label="Dominio propio" value={dominio} onChange={(e) => setDominio(e.target.value)} />
          <button type="button" className="rs-btn rs-btn--secundario rs-btn--sm" disabled={guardarDominio.isPending || dominio === (org.customDomain ?? '')} onClick={() => guardarDominio.mutateAsync().then(() => setOk('Dominio guardado.')).catch(() => undefined)}>
            Guardar
          </button>
        </div>
        {branding.draft && (
          <Ajuste t="Quitar «Creado con Rifa Star»" d="Marca blanca en tus enlaces públicos (plan Agencia).">
            <Switch
              label="Quitar marca de Rifa Star"
              checked={branding.draft.hideRifaStarBadge}
              onChange={(v) => branding.setDraft({ ...branding.draft!, hideRifaStarBadge: v })}
            />
          </Ajuste>
        )}
        {branding.draft && (
          <fieldset className="bare-fieldset stack" style={{ gap: 12 }}>
            <legend className="rs-label">Redes del organizador (se muestran en tus sorteos)</legend>
            <div className="grid-auto" style={{ '--min': '220px' } as CSSProperties}>
              {(
                [
                  ['instagramUrl', 'Instagram', 'https://www.instagram.com/tunegocio'],
                  ['facebookUrl', 'Facebook', 'https://www.facebook.com/tunegocio'],
                  ['tiktokUrl', 'TikTok', 'https://www.tiktok.com/@tunegocio'],
                ] as const
              ).map(([k, label, ph]) => (
                <div key={k}>
                  <label className="rs-label" htmlFor={k}>{label}</label>
                  <input
                    id={k}
                    className="rs-in"
                    inputMode="url"
                    placeholder={ph}
                    value={branding.draft![k] ?? ''}
                    onChange={(e) => branding.setDraft({ ...branding.draft!, [k]: e.target.value.trim() || null })}
                  />
                </div>
              ))}
            </div>
            <div className="ajustes-acciones">
              <button type="button" className="rs-btn rs-btn--secundario" disabled={!branding.dirty || branding.save.isPending} onClick={branding.reset}>Descartar</button>
              <button type="button" className="rs-btn rs-btn--primario" disabled={!branding.dirty || branding.save.isPending} onClick={() => branding.save.mutateAsync().then(() => setOk('Marca y redes actualizadas.')).catch(() => undefined)}>
                Guardar marca y redes
              </button>
            </div>
          </fieldset>
        )}
      </fieldset>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Pagos
// ---------------------------------------------------------------------------

function ComprobantesAjustes() {
  const can = useCan();
  const form = useSectionForm<{
    issuerName: string;
    taxId: string;
    address: string;
    phone: string;
    email: string;
    conceptTemplate: string;
    unitLabel: string;
    footer: string;
  }>('receipts');
  const draft = form.draft;
  const set = (key: keyof NonNullable<typeof draft>, value: string) => draft && form.setDraft({ ...draft, [key]: value });

  if (!draft) return form.q.error ? <ErrorNote error={form.q.error} /> : <Loading />;
  const editable = can('settings.brand');
  return (
    <section className="rs-panel panel-pad" style={{ gap: 18 }}>
      <div>
        <h2 className="h2 h2--lg">Comprobantes de ingreso</h2>
        <p className="muted">Personaliza los datos que aparecerán en los comprobantes nuevos. Los ya emitidos conservan su versión original.</p>
      </div>
      <ErrorNote error={form.save.error} />
      <fieldset className="bare-fieldset stack" style={{ gap: 16 }} disabled={!editable}>
        <div className="grid-auto" style={{ '--min': '220px' } as CSSProperties}>
          <div><label className="rs-label" htmlFor="rec-issuer">Nombre o razón social</label><input id="rec-issuer" className="rs-in" maxLength={120} value={draft.issuerName} onChange={(e) => set('issuerName', e.target.value)} placeholder="Usar el nombre de la organización" /></div>
          <div><label className="rs-label" htmlFor="rec-tax">NIT o documento (opcional)</label><input id="rec-tax" className="rs-in" maxLength={40} value={draft.taxId} onChange={(e) => set('taxId', e.target.value)} /></div>
          <div><label className="rs-label" htmlFor="rec-address">Dirección</label><input id="rec-address" className="rs-in" maxLength={180} value={draft.address} onChange={(e) => set('address', e.target.value)} /></div>
          <div><label className="rs-label" htmlFor="rec-phone">Teléfono de contacto</label><input id="rec-phone" className="rs-in" maxLength={30} value={draft.phone} onChange={(e) => set('phone', e.target.value)} /></div>
          <div><label className="rs-label" htmlFor="rec-email">Correo de contacto</label><input id="rec-email" className="rs-in" type="email" maxLength={120} value={draft.email} onChange={(e) => set('email', e.target.value)} /></div>
        </div>
        <div>
          <label className="rs-label" htmlFor="rec-template">Concepto de compra</label>
          <input id="rec-template" className="rs-in" maxLength={180} value={draft.conceptTemplate} onChange={(e) => set('conceptTemplate', e.target.value)} />
          <p className="rs-help">Variables: {'{cantidad}'}, {'{concepto}'} y {'{sorteo}'}. Ejemplo: «Se compraron 100 tickets para el sorteo Gran Premio».</p>
        </div>
        <div className="grid-auto" style={{ '--min': '220px' } as CSSProperties}>
          <div><label className="rs-label" htmlFor="rec-unit">Nombre de cada unidad</label><input id="rec-unit" className="rs-in" maxLength={32} value={draft.unitLabel} onChange={(e) => set('unitLabel', e.target.value)} placeholder="números, tickets, boletos…" /></div>
          <div><label className="rs-label" htmlFor="rec-footer">Mensaje al final</label><input id="rec-footer" className="rs-in" maxLength={300} value={draft.footer} onChange={(e) => set('footer', e.target.value)} /></div>
        </div>
      </fieldset>
      <p className="rs-help">Se incluye el detalle de la compra, cantidad, valor unitario, total, boletos y datos del cliente. El logo y color usan la marca de tu organización.</p>
      <Acciones dirty={form.dirty} saving={form.save.isPending} onReset={form.reset} onSave={() => form.save.mutateAsync().catch(() => undefined)} />
    </section>
  );
}

function Pagos() {
  const can = useCan();
  const s = useSectionForm<{ reservationMinutes: 30 | 60 | 120; requireReceipt: boolean; maxHeldPerPhone: number }>('payments');
  const accounts = useOrgQuery<PaymentAccount[]>('/v1/payment-accounts');
  const [nueva, setNueva] = useState(false);
  const [ok, setOk] = useState<string | null>(null);
  const quitar = useOrgMutation<string>((id, req) => req(`/v1/payment-accounts/${id}`, { method: 'DELETE' }).then(() => undefined));
  if (!s.draft) return <Loading />;
  const editable = can('settings.brand');

  return (
    <section className="rs-panel setting-panel">
      <h2 className="h2 h2--lg setting-panel__title">Pagos</h2>
      {ok && <OkNote>{ok}</OkNote>}
      <ErrorNote error={s.save.error ?? quitar.error} />
      <Ajuste t="Cuentas para recibir pagos" d="El participante las ve con un botón para copiar.">
        {editable && <button type="button" className="rs-btn rs-btn--secundario rs-btn--sm" onClick={() => setNueva(true)}>Agregar cuenta</button>}
      </Ajuste>
      <div className="list-card" style={{ margin: '0 24px' }}>
        {(accounts.data ?? []).map((a) => (
          <div key={a.id} className="list-row" style={{ justifyContent: 'space-between' }}>
            <span>
              <b>{a.typeLabel}</b> · <span className="rs-mono">{a.keyOrNumber}</span><br />
              <span className="cell-sub">{a.holderName}{a.bankName ? ` · ${a.bankName} (${a.accountKind})` : ''}</span>
            </span>
            {editable && (
              <button type="button" className="rs-btn rs-btn--fantasma rs-btn--sm" style={{ color: 'var(--rojo-texto)' }} onClick={() => quitar.mutate(a.id)}>Quitar</button>
            )}
          </div>
        ))}
        {accounts.data?.length === 0 && <Empty>Agrega al menos una cuenta para poder publicar sorteos.</Empty>}
      </div>
      <Ajuste t="Tiempo de apartado" d="Cuánto tiempo queda reservado un número mientras el participante paga.">
        <select
          className="rs-in"
          aria-label="Tiempo de apartado"
          style={{ width: 160 }}
          disabled={!editable}
          value={s.draft.reservationMinutes}
          onChange={(e) => s.setDraft({ ...s.draft!, reservationMinutes: Number(e.target.value) as 30 | 60 | 120 })}
        >
          <option value={30}>30 minutos</option>
          <option value={60}>1 hora</option>
          <option value={120}>2 horas</option>
        </select>
      </Ajuste>
      <Ajuste t="Exigir comprobante" d="El participante debe subir la captura para enviar su pago a verificación.">
        <Switch label="Exigir comprobante" disabled={!editable} checked={s.draft.requireReceipt} onChange={(v) => s.setDraft({ ...s.draft!, requireReceipt: v })} />
      </Ajuste>
      <Ajuste
        t="Máximo de números apartados sin pagar"
        d="Por WhatsApp y sorteo. Evita que alguien (o un bot) aparte todos los números y no pague. 0 = sin límite."
      >
        <input
          className="rs-in rs-mono"
          aria-label="Máximo de números apartados sin pagar"
          style={{ width: 110, textAlign: 'center' }}
          inputMode="numeric"
          disabled={!editable}
          value={s.draft.maxHeldPerPhone}
          onChange={(e) => s.setDraft({ ...s.draft!, maxHeldPerPhone: Math.min(1000, Number(e.target.value.replace(/\D/g, '')) || 0) })}
        />
      </Ajuste>
      <Ajuste t="Quién puede aprobar pagos" d="Propietario, administradores y verificadores de pago (o roles con ese permiso). Nadie aprueba una venta con su propio código de vendedor.">
        <Link to="/admin/ajustes?tab=equipo" className="rs-btn rs-btn--fantasma rs-btn--sm">Ver roles</Link>
      </Ajuste>
      {editable && <div style={{ padding: '0 24px 24px' }}><Acciones dirty={s.dirty} saving={s.save.isPending} onReset={s.reset} onSave={() => s.save.mutateAsync().then(() => setOk('Cambios guardados.')).catch(() => undefined)} /></div>}
      {nueva && <NuevaCuenta onClose={() => setNueva(false)} onCreated={() => { setNueva(false); setOk('Cuenta agregada.'); }} />}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

interface RankingCfg {
  enabled: boolean;
  pointsPerNumber: number;
  consistencyBonus: { enabled: boolean; minRaffles: number; points: number };
  referralBonus: { enabled: boolean; points: number };
  frequency: 'monthly' | 'biweekly' | 'weekly';
  weeklyResetDay: number;
  tiebreaker: 'first_to_reach' | 'most_raffles';
  publicTopSize: 10 | 20 | 50;
  nameFormat: 'first_name_initial' | 'initials' | 'nickname';
  prizes: string[];
  announceOnClose: boolean;
}

const DIAS = ['', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const num = (v: string, min = 0) => Math.max(min, parseInt(v.replace(/\D/g, ''), 10) || 0);

function RankingAjustes() {
  const can = useCan();
  const { data: org } = useOrgProfile();
  const s = useSectionForm<RankingCfg>('ranking');
  const [ok, setOk] = useState<string | null>(null);
  if (!s.draft) return <Loading />;
  const d = s.draft;
  const set = (patch: Partial<RankingCfg>) => s.setDraft({ ...d, ...patch });
  const premios = [...d.prizes, '', '', ''].slice(0, Math.max(3, d.prizes.length));

  return (
    <section className="rs-panel setting-panel">
      <div className="setting-panel__title ajustes-head">
        <h2 className="h2 h2--lg">Ranking</h2>
        <Link to={`/${org?.slug}/ranking`} className="rs-btn rs-btn--secundario rs-btn--sm">Ver enlace público</Link>
      </div>
      {ok && <OkNote>{ok}</OkNote>}
      <ErrorNote error={s.save.error} />
      <fieldset className="bare-fieldset" disabled={!can('ranking.configure')}>
        <Ajuste t="Activar ranking" d="Lista pública de quienes más participan. Motiva a comprar más números cada periodo.">
          <Switch label="Activar ranking" checked={d.enabled} onChange={(v) => set({ enabled: v })} />
        </Ajuste>
        <Ajuste t="Reinicio" d="El ranking vuelve a cero y el periodo anterior queda en el historial.">
          <div className="ajustes-selects">
            <select className="rs-in" aria-label="Frecuencia" style={{ width: 150 }} value={d.frequency} onChange={(e) => set({ frequency: e.target.value as RankingCfg['frequency'] })}>
              <option value="monthly">Mensual (día 1)</option>
              <option value="biweekly">Quincenal (1 y 16)</option>
              <option value="weekly">Semanal</option>
            </select>
            {d.frequency === 'weekly' && (
              <select className="rs-in" aria-label="Día de reinicio" style={{ width: 150 }} value={d.weeklyResetDay} onChange={(e) => set({ weeklyResetDay: Number(e.target.value) })}>
                {DIAS.slice(1).map((dia, i) => <option key={dia} value={i + 1}>{dia}, 12:00 a. m.</option>)}
              </select>
            )}
          </div>
        </Ajuste>
        <Ajuste t="Cómo se suman puntos" d="Solo cuentan números pagos y verificados.">
          <div className="puntos-grid">
            <span>Puntos por número pagado</span>
            <input className="rs-in rs-mono" value={d.pointsPerNumber} onChange={(e) => set({ pointsPerNumber: num(e.target.value, 1) })} aria-label="Puntos por número" />
            <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input type="checkbox" checked={d.consistencyBonus.enabled} onChange={(e) => set({ consistencyBonus: { ...d.consistencyBonus, enabled: e.target.checked } })} />
              Bono por jugar
              <input className="rs-in rs-mono" style={{ width: 56 }} value={d.consistencyBonus.minRaffles} onChange={(e) => set({ consistencyBonus: { ...d.consistencyBonus, minRaffles: num(e.target.value, 2) } })} aria-label="Sorteos mínimos para el bono" />
              + sorteos
            </label>
            <input className="rs-in rs-mono" value={d.consistencyBonus.points} onChange={(e) => set({ consistencyBonus: { ...d.consistencyBonus, points: num(e.target.value, 1) } })} aria-label="Bono por constancia" />
            <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input type="checkbox" checked={d.referralBonus.enabled} onChange={(e) => set({ referralBonus: { ...d.referralBonus, enabled: e.target.checked } })} />
              Bono por referir a alguien
            </label>
            <input className="rs-in rs-mono" value={d.referralBonus.points} onChange={(e) => set({ referralBonus: { ...d.referralBonus, points: num(e.target.value, 1) } })} aria-label="Bono por referido" />
          </div>
        </Ajuste>
        <Ajuste t="Desempate" d="Si dos personas tienen los mismos puntos.">
          <select className="rs-in" aria-label="Desempate" style={{ width: 240 }} value={d.tiebreaker} onChange={(e) => set({ tiebreaker: e.target.value as RankingCfg['tiebreaker'] })}>
            <option value="first_to_reach">Gana quien llegó primero</option>
            <option value="most_raffles">Gana quien jugó más sorteos</option>
          </select>
        </Ajuste>
        <Ajuste t="Qué se muestra en público" d="Nunca se muestra el número de WhatsApp completo.">
          <div className="ajustes-selects ajustes-selects--col">
            <select className="rs-in" aria-label="Formato del nombre" style={{ width: 240 }} value={d.nameFormat} onChange={(e) => set({ nameFormat: e.target.value as RankingCfg['nameFormat'] })}>
              <option value="first_name_initial">Nombre e inicial (Laura M.)</option>
              <option value="initials">Solo iniciales (L. M.)</option>
              <option value="nickname">Apodo que elija</option>
            </select>
            <select className="rs-in" aria-label="Cantidad visible" style={{ width: 240 }} value={d.publicTopSize} onChange={(e) => set({ publicTopSize: Number(e.target.value) as 10 | 20 | 50 })}>
              <option value={10}>Top 10</option>
              <option value={20}>Top 20</option>
              <option value={50}>Top 50</option>
            </select>
          </div>
        </Ajuste>
        <Ajuste t="Premios del ranking" d="Se entregan al cerrar el periodo. Déjalos vacíos si no das premio." style={{ flexWrap: 'wrap' }}>
          <div className="premios-ranking">
            {premios.map((p, i) => (
              <span key={i} style={{ display: 'contents' }}>
                <span className="rs-mono premios-ranking__pos">{i + 1}°</span>
                <input
                  className="rs-in"
                  value={p}
                  aria-label={`Premio del puesto ${i + 1}`}
                  onChange={(e) => {
                    const next = [...premios];
                    next[i] = e.target.value;
                    set({ prizes: next.map((x) => x.trim()).filter(Boolean) });
                  }}
                />
              </span>
            ))}
          </div>
        </Ajuste>
        <Ajuste t="Anunciar al cerrar" d="Envía el top 10 por WhatsApp a tus participantes el día del reinicio.">
          <Switch label="Anunciar al cerrar" checked={d.announceOnClose} onChange={(v) => set({ announceOnClose: v })} />
        </Ajuste>
      </fieldset>
      {can('ranking.configure') && <div style={{ padding: '0 24px 24px' }}><Acciones dirty={s.dirty} saving={s.save.isPending} onReset={s.reset} onSave={() => s.save.mutateAsync().then(() => setOk('Cambios guardados.')).catch(() => undefined)} /></div>}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Equipo y roles
// ---------------------------------------------------------------------------

interface MemberRow {
  id: string;
  status: 'invited' | 'active';
  sellerCode: string | null;
  lastAccessAt: string | null;
  user: { id: string; name: string; email: string };
  role: { id: string; key: string; name: string; organizationId: string | null };
}
interface RoleRow { id: string; key: string; name: string; description: string | null; custom: boolean; permissions: string[]; membersCount?: number }
interface PermissionDef { key: string; group: string; description: string }

function Equipo() {
  const can = useCan();
  const team = useOrgQuery<MemberRow[]>(can('settings.team') ? '/v1/team' : null);
  const roles = useOrgQuery<RoleRow[]>(can('settings.team') ? '/v1/roles' : null);
  const billing = useOrgQuery<{ usage: { members: { used: number; limit: number } } }>(can('settings.billing') ? '/v1/billing' : null);
  const [invitar, setInvitar] = useState(false);
  const [nuevoRol, setNuevoRol] = useState<RoleRow | 'nuevo' | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const cambiar = useOrgMutation<{ id: string; body: object }>(({ id, body }, req) => req(`/v1/team/members/${id}`, { method: 'PATCH', body }).then(() => undefined));
  const quitar = useOrgMutation<string>((id, req) => req(`/v1/team/members/${id}`, { method: 'DELETE' }).then(() => undefined));
  const reenviar = useOrgMutation<string>((id, req) => req(`/v1/team/members/${id}/resend-invitation`, { method: 'POST' }).then(() => undefined));

  if (!can('settings.team')) {
    return (
      <section className="rs-panel panel-pad">
        <h2 className="h2 h2--lg">Equipo y roles</h2>
        <p className="muted">Solo el propietario (o un rol con «Invitar y quitar miembros») administra el equipo.</p>
      </section>
    );
  }
  if (team.isLoading || roles.isLoading) return <Loading />;
  const asignables = roles.data ?? [];
  const uso = billing.data?.usage.members;

  return (
    <section className="rs-panel overflow-hidden">
      <div className="ajustes-head ajustes-head--equipo">
        <div>
          <h2 className="h2 h2--lg">Equipo y roles</h2>
          {uso && <p className="rs-help">{uso.used} de {uso.limit} miembros en tu plan.</p>}
        </div>
        <button type="button" className="rs-btn rs-btn--primario rs-btn--sm" onClick={() => setInvitar(true)}>Invitar miembro</button>
      </div>
      <div style={{ padding: '0 24px' }}>
        {ok && <OkNote>{ok}</OkNote>}
        <ErrorNote error={team.error ?? cambiar.error ?? quitar.error ?? reenviar.error} />
      </div>
      <div className="table-scroll">
        <table className="rs-tabla" style={{ minWidth: 640 }}>
          <thead><tr><th>Miembro</th><th>Rol</th><th>Código vendedor</th><th>Último acceso</th><th></th></tr></thead>
          <tbody>
            {(team.data ?? []).map((m) => (
              <tr key={m.id}>
                <td><b>{m.user.name}</b><br /><span className="cell-sub">{m.status === 'invited' ? `Invitación pendiente · ${m.user.email}` : m.user.email}</span></td>
                <td>
                  {m.role.key === 'owner' && m.role.organizationId === null ? (
                    <Badge tono="ganador">Propietario</Badge>
                  ) : (
                    <select className="rs-in" aria-label={`Rol de ${m.user.name}`} style={{ width: 200 }} value={m.role.id} onChange={(e) => cambiar.mutate({ id: m.id, body: { roleId: e.target.value } })}>
                      {asignables.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </select>
                  )}
                </td>
                <td className="rs-mono">{m.sellerCode ?? '—'}</td>
                <td>{m.status === 'invited' ? '—' : timeAgo(m.lastAccessAt)}</td>
                <td className="td-right">
                  {m.status === 'invited' && (
                    <button type="button" className="rs-btn rs-btn--fantasma rs-btn--sm" onClick={() => reenviar.mutateAsync(m.id).then(() => setOk('Invitación reenviada.')).catch(() => undefined)}>Reenviar</button>
                  )}
                  <button type="button" className="rs-btn rs-btn--fantasma rs-btn--sm" style={{ color: 'var(--rojo-texto)' }} onClick={() => quitar.mutate(m.id)}>Quitar</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="panel-head" style={{ borderTop: '1px solid var(--linea)' }}>
        <h3 className="h2 h2--sm">Roles</h3>
        <button type="button" className="rs-btn rs-btn--secundario rs-btn--sm" onClick={() => setNuevoRol('nuevo')}>Crear rol personalizado</button>
      </div>
      <div className="roles-resumen">
        {(roles.data ?? []).map((r) => (
          <div key={r.id}>
            <div className="setting__t">
              {r.name} {r.custom && <button type="button" className="small-link rs-btn rs-btn--fantasma rs-btn--sm" onClick={() => setNuevoRol(r)}>Editar</button>}
            </div>
            <div className="setting__d">{r.description ?? `${r.permissions.length} permisos`}{r.membersCount !== undefined && ` · ${r.membersCount} miembros`}</div>
          </div>
        ))}
      </div>
      {invitar && <Invitar roles={asignables} onClose={() => setInvitar(false)} onDone={(email) => { setInvitar(false); setOk(`Enviamos la invitación a ${email}.`); }} />}
      {nuevoRol && <EditorRol rol={nuevoRol === 'nuevo' ? null : nuevoRol} onClose={() => setNuevoRol(null)} onDone={() => { setNuevoRol(null); setOk('Rol guardado.'); }} />}
    </section>
  );
}

function Invitar({ roles, onClose, onDone }: { roles: RoleRow[]; onClose: () => void; onDone: (email: string) => void }) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [roleId, setRoleId] = useState(roles.find((r) => r.key === 'admin')?.id ?? roles[0]?.id ?? '');
  const [sellerCode, setSellerCode] = useState('');
  const esVendedor = roles.find((r) => r.id === roleId)?.key === 'seller';
  const m = useOrgMutation<void>((_v, req) => req('/v1/team/invitations', { body: { email, name, roleId, ...(sellerCode && { sellerCode }) } }).then(() => undefined));
  return (
    <Modal
      title="Invitar miembro"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="rs-btn rs-btn--secundario" onClick={onClose}>Cancelar</button>
          <button type="button" className="rs-btn rs-btn--primario" disabled={m.isPending} onClick={() => m.mutateAsync().then(() => onDone(email)).catch(() => undefined)}>Enviar invitación</button>
        </>
      }
    >
      <div>
        <label className="rs-label" htmlFor="inombre">Nombre</label>
        <input id="inombre" className="rs-in" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div>
        <label className="rs-label" htmlFor="icorreo">Correo</label>
        <input id="icorreo" className="rs-in" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div>
        <label className="rs-label" htmlFor="irol">Rol</label>
        <select id="irol" className="rs-in" value={roleId} onChange={(e) => setRoleId(e.target.value)}>
          {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      </div>
      {esVendedor && (
        <div>
          <label className="rs-label" htmlFor="icodigo">Código de vendedor</label>
          <input id="icodigo" className="rs-in rs-mono" value={sellerCode} onChange={(e) => setSellerCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} placeholder="LUIS" />
          <p className="rs-help">Sus ventas se atribuyen por este código en el enlace.</p>
        </div>
      )}
      <ErrorNote error={m.error} />
    </Modal>
  );
}

function EditorRol({ rol, onClose, onDone }: { rol: RoleRow | null; onClose: () => void; onDone: () => void }) {
  const catalog = useOrgQuery<PermissionDef[]>('/v1/permissions');
  const [name, setName] = useState(rol?.name ?? '');
  const [perms, setPerms] = useState<string[]>(rol?.permissions ?? ['raffles.view']);
  const save = useOrgMutation<void>((_v, req) =>
    req(rol ? `/v1/roles/${rol.id}` : '/v1/roles', { method: rol ? 'PATCH' : 'POST', body: { name, permissions: perms } }).then(() => undefined),
  );
  const borrar = useOrgMutation<void>((_v, req) => req(`/v1/roles/${rol!.id}`, { method: 'DELETE' }).then(() => undefined));
  const grupos = [...new Set((catalog.data ?? []).map((p) => p.group))];
  return (
    <Modal
      title={rol ? `Editar «${rol.name}»` : 'Nuevo rol'}
      onClose={onClose}
      footer={
        <>
          {rol && <button type="button" className="rs-btn rs-btn--fantasma" style={{ color: 'var(--rojo-texto)', marginRight: 'auto' }} onClick={() => borrar.mutateAsync().then(onDone).catch(() => undefined)}>Eliminar</button>}
          <button type="button" className="rs-btn rs-btn--secundario" onClick={onClose}>Cancelar</button>
          <button type="button" className="rs-btn rs-btn--primario" disabled={save.isPending || !name.trim() || perms.length === 0} onClick={() => save.mutateAsync().then(onDone).catch(() => undefined)}>Guardar</button>
        </>
      }
    >
      <div>
        <label className="rs-label" htmlFor="rnombre">Nombre del rol</label>
        <input id="rnombre" className="rs-in" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      {grupos.map((g) => (
        <fieldset key={g} className="bare-fieldset">
          <legend className="eyebrow">{g}</legend>
          {(catalog.data ?? []).filter((p) => p.group === g).map((p) => (
            <label key={p.key} className="check-row" style={{ padding: '6px 0' }}>
              <input type="checkbox" checked={perms.includes(p.key)} onChange={(e) => setPerms((cur) => (e.target.checked ? [...cur, p.key] : cur.filter((x) => x !== p.key)))} />
              <span>{p.description}</span>
            </label>
          ))}
        </fieldset>
      ))}
      <ErrorNote error={save.error ?? borrar.error} />
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Notificaciones
// ---------------------------------------------------------------------------

function Notificaciones() {
  const can = useCan();
  const s = useSectionForm<{
    purchaseConfirmation: boolean;
    drawReminder: boolean;
    newRaffleNotice: boolean;
    dailyDigest: boolean;
    managerAlerts: boolean;
    deliveryReminder: boolean;
    deliveryReminderHours: number;
  }>('notifications');
  const [ok, setOk] = useState<string | null>(null);
  if (!s.draft) return <Loading />;
  const d = s.draft;
  const editable = can('settings.brand');
  return (
    <section className="rs-panel setting-panel">
      <h2 className="h2 h2--lg setting-panel__title">Notificaciones por WhatsApp</h2>
      {ok && <OkNote>{ok}</OkNote>}
      <ErrorNote error={s.save.error} />
      <Ajuste t="Confirmación de compra" d="Al aprobar el pago, el participante recibe su boleto.">
        <Switch label="Confirmación de compra" disabled={!editable} checked={d.purchaseConfirmation} onChange={(v) => s.setDraft({ ...d, purchaseConfirmation: v })} />
      </Ajuste>
      <Ajuste t="Recordatorio antes del sorteo" d="2 horas antes, a quienes tienen números pagos.">
        <Switch label="Recordatorio" disabled={!editable} checked={d.drawReminder} onChange={(v) => s.setDraft({ ...d, drawReminder: v })} />
      </Ajuste>
      <Ajuste t="Aviso de nuevo sorteo" d={'A quienes pidieron "Avísame".'}>
        <Switch label="Aviso de nuevo sorteo" disabled={!editable} checked={d.newRaffleNotice} onChange={(v) => s.setDraft({ ...d, newRaffleNotice: v })} />
      </Ajuste>
      <Ajuste t="Resumen diario para mí" d="Ventas y pagos pendientes a las 8:00 p. m., al WhatsApp de soporte.">
        <Switch label="Resumen diario" disabled={!editable} checked={d.dailyDigest} onChange={(v) => s.setDraft({ ...d, dailyDigest: v })} />
      </Ajuste>
      <Ajuste
        t="Avisos al equipo: resultado y ganadores"
        d="Por WhatsApp y correo a todos los gestores (con permiso de anunciar ganadores): el resultado que reporta LoteríaYa y, al ingresar el resultado, los ganadores con su contacto. El WhatsApp llega a quien tenga su número verificado en Ajustes › Seguridad."
      >
        <Switch label="Avisos al equipo" disabled={!editable} checked={d.managerAlerts} onChange={(v) => s.setDraft({ ...d, managerAlerts: v })} />
      </Ajuste>
      <Ajuste t="Recordatorio de entrega de premios" d="Si un premio con ganador sigue sin marcarse como entregado, se le recuerda al equipo cada cierto tiempo.">
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {d.deliveryReminder && (
            <select
              className="rs-in"
              aria-label="Cada cuánto recordar"
              style={{ width: 150 }}
              disabled={!editable}
              value={d.deliveryReminderHours}
              onChange={(e) => s.setDraft({ ...d, deliveryReminderHours: Number(e.target.value) })}
            >
              <option value={24}>Cada 24 horas</option>
              <option value={48}>Cada 48 horas</option>
              <option value={72}>Cada 3 días</option>
              <option value={168}>Cada semana</option>
            </select>
          )}
          <Switch label="Recordatorio de entrega" disabled={!editable} checked={d.deliveryReminder} onChange={(v) => s.setDraft({ ...d, deliveryReminder: v })} />
        </div>
      </Ajuste>
      {editable && <div style={{ padding: '0 24px 24px' }}><Acciones dirty={s.dirty} saving={s.save.isPending} onReset={s.reset} onSave={() => s.save.mutateAsync().then(() => setOk('Cambios guardados.')).catch(() => undefined)} /></div>}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Plan y facturación
// ---------------------------------------------------------------------------

interface Billing {
  status: string;
  plan: { code: string; name: string; monthlyPriceCop: number };
  subscription: { status: string; provider: string; trialEndsAt: string | null; currentPeriodEnd: string | null; cancelAtPeriodEnd: boolean; pastDueSince: string | null } | null;
  usage: { activeRaffles: { used: number; limit: number | null }; members: { used: number; limit: number }; whatsappMessages: { used: number; limit: number } };
  invoices: { id: string; amountCop: number; status: string; paidAt: string | null; attemptedAt: string | null; failureReason: string | null }[];
}
interface CatalogPlan {
  code: string;
  name: string;
  monthlyPriceCop: number;
  highlighted: boolean;
  purchasable: boolean;
  limits: { activeRaffles: number | null; members: number; whatsappMessages: number };
  features: Record<string, boolean>;
}

const FEATURE_LABELS: Record<string, string> = {
  ranking: 'Ranking con enlace público',
  whatsappAutomation: 'Notificaciones por WhatsApp',
  sellers: 'Vendedores con código',
  customRoles: 'Roles personalizados',
  customDomain: 'Dominio propio',
  whiteLabel: 'Sin «Creado con Rifa Star»',
};

function Plan() {
  const can = useCan();
  const { data: org } = useOrgProfile();
  const b = useOrgQuery<Billing>(can('settings.billing') ? '/v1/billing' : null);
  const catalog = useOrgQuery<CatalogPlan[]>(can('settings.billing') ? '/v1/billing/plans' : null);
  const [elegir, setElegir] = useState(false);
  const checkout = useOrgMutation<string, { url: string }>((planCode, req) => req('/v1/billing/checkout', { body: { planCode } }));
  const portal = useOrgMutation<void, { url: string }>((_v, req) => req('/v1/billing/portal', { method: 'POST' }));

  if (!can('settings.billing')) {
    return (
      <section className="rs-panel panel-pad">
        <h2 className="h2 h2--lg">Plan y facturación</h2>
        <p className="muted">Solo el propietario ve el plan y la facturación.</p>
      </section>
    );
  }
  if (!b.data) return b.error ? <ErrorNote error={b.error} /> : <Loading />;
  const d = b.data;
  const tz = org?.timezone;
  const pct = (used: number, limit: number | null) => (limit ? Math.min(100, Math.round((used / limit) * 100)) : 0);
  const estado =
    d.subscription?.status === 'trialing'
      ? `Prueba gratis hasta el ${d.subscription.trialEndsAt ? formatDay(d.subscription.trialEndsAt, tz) : '—'}`
      : d.subscription?.status === 'past_due'
        ? 'Pago vencido: actualiza tu método de pago'
        : d.subscription?.currentPeriodEnd
          ? `Renueva el ${formatDay(d.subscription.currentPeriodEnd, tz)}`
          : 'Activo';

  return (
    <section className="rs-panel panel-pad" style={{ gap: 20 }}>
      <div className="ajustes-head">
        <div>
          <h2 className="h2 h2--lg">Plan {d.plan.name}</h2>
          <p className="rs-help">{cop(d.plan.monthlyPriceCop)} / mes · {estado}</p>
        </div>
        <button type="button" className="rs-btn rs-btn--secundario rs-btn--sm" onClick={() => setElegir(true)}>Cambiar plan</button>
      </div>
      <ErrorNote error={checkout.error ?? portal.error} />
      <div className="grid-auto">
        <Uso t="Sorteos activos" pct={pct(d.usage.activeRaffles.used, d.usage.activeRaffles.limit)} d={`${d.usage.activeRaffles.used} de ${d.usage.activeRaffles.limit ?? 'ilimitados'}`} />
        <Uso t="Miembros del equipo" pct={pct(d.usage.members.used, d.usage.members.limit)} d={`${d.usage.members.used} de ${d.usage.members.limit}`} />
        <Uso t="Mensajes de WhatsApp" pct={pct(d.usage.whatsappMessages.used, d.usage.whatsappMessages.limit)} d={`${d.usage.whatsappMessages.used.toLocaleString('es-CO')} de ${d.usage.whatsappMessages.limit.toLocaleString('es-CO')} este mes`} />
      </div>
      {d.subscription?.provider && d.subscription.provider !== 'manual' && (
        <Ajuste t="Método de pago y facturas" d="Se administra de forma segura en la pasarela de pagos." style={{ borderTop: '1px solid var(--linea)' }}>
          <button type="button" className="rs-btn rs-btn--fantasma rs-btn--sm" disabled={portal.isPending} onClick={() => portal.mutateAsync().then((r) => (window.location.href = r.url)).catch(() => undefined)}>
            Administrar
          </button>
        </Ajuste>
      )}
      {d.invoices.length > 0 && (
        <div className="table-scroll">
          <table className="rs-tabla">
            <thead><tr><th>Fecha</th><th>Valor</th><th>Estado</th></tr></thead>
            <tbody>
              {d.invoices.map((i) => (
                <tr key={i.id}>
                  <td>{i.paidAt ?? i.attemptedAt ? formatDay((i.paidAt ?? i.attemptedAt)!, tz) : '—'}</td>
                  <td className="td-mono">{cop(i.amountCop)}</td>
                  <td>{i.status === 'paid' ? <Badge tono="abierto">Pagada</Badge> : <Badge tono="urgente">{i.failureReason ?? 'Fallida'}</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {elegir && (
        <Modal title="Elige tu plan" onClose={() => setElegir(false)}>
          {(catalog.data ?? []).map((p) => (
            <div key={p.code} className="rs-card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8, border: p.code === d.plan.code ? '2px solid var(--verde)' : undefined }}>
              <div className="fila-sb" style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <b className="h2 h2--sm">{p.name}{p.highlighted && <Badge tono="abierto" style={{ marginLeft: 8 }}>Más elegido</Badge>}</b>
                <span className="rs-mono">{cop(p.monthlyPriceCop)}/mes</span>
              </div>
              <span className="rs-help">
                {p.limits.activeRaffles ?? '∞'} sorteos activos · {p.limits.members} miembros · {p.limits.whatsappMessages.toLocaleString('es-CO')} mensajes/mes
              </span>
              <span className="rs-help">{Object.entries(p.features).filter(([, v]) => v).map(([k]) => FEATURE_LABELS[k]).join(' · ') || 'Funciones básicas'}</span>
              {p.code === d.plan.code ? (
                <Badge tono="cerrado">Tu plan actual</Badge>
              ) : p.purchasable ? (
                <button type="button" className="rs-btn rs-btn--primario rs-btn--sm" disabled={checkout.isPending} onClick={() => checkout.mutateAsync(p.code).then((r) => (window.location.href = r.url)).catch(() => undefined)}>
                  Elegir {p.name}
                </button>
              ) : (
                <span className="rs-help">Escríbenos a soporte para activarlo.</span>
              )}
            </div>
          ))}
          <ErrorNote error={checkout.error} />
        </Modal>
      )}
    </section>
  );
}

function Uso({ t, pct, d }: { t: string; pct: number; d: string }) {
  return (
    <div>
      <div className="setting__t">{t}</div>
      <div className="rs-progreso" style={{ margin: '8px 0 6px' }}><span style={{ width: `${pct}%` }} /></div>
      <div className="setting__d">{d}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Seguridad: verificación en dos pasos, WhatsApp del gestor y sesiones
// ---------------------------------------------------------------------------

interface SessionRow {
  id: string;
  device: string;
  ip: string | null;
  startedAt: string;
  lastUsedAt: string;
  current: boolean;
}

function Seguridad() {
  const session = useSession();
  const me = session.me;
  const [ok, setOk] = useState<string | null>(null);
  const [setup, setSetup] = useState<{ secret: string; qr: string } | null>(null);
  const [codigo, setCodigo] = useState('');
  const [desactivar, setDesactivar] = useState({ code: '', password: '' });
  const [telefono, setTelefono] = useState('');
  const [codigoTel, setCodigoTel] = useState('');
  const [esperandoCodigo, setEsperandoCodigo] = useState(false);
  const sesiones = useOrgQuery<SessionRow[]>('/v1/auth/sessions');

  const iniciar2fa = useOrgMutation<void>(async (_v, req) => {
    const r = await req<{ otpauthUrl: string; secret: string }>('/v1/auth/2fa/setup', { method: 'POST' });
    setSetup({ secret: r.secret, qr: await QRCode.toDataURL(r.otpauthUrl, { margin: 1, width: 200 }) });
  });
  const activar2fa = useOrgMutation<void>(async (_v, req) => {
    await req('/v1/auth/2fa/enable', { body: { code: codigo } });
    setSetup(null);
    setCodigo('');
    await session.refreshMe();
  });
  const quitar2fa = useOrgMutation<void>(async (_v, req) => {
    await req('/v1/auth/2fa/disable', { body: desactivar });
    setDesactivar({ code: '', password: '' });
    await session.refreshMe();
  });
  const pedirCodigo = useOrgMutation<void, { devCode?: string }>((_v, req) => req('/v1/me/phone', { body: { phone: telefono } }));
  const verificarTel = useOrgMutation<void>(async (_v, req) => {
    await req('/v1/me/phone/verify', { body: { code: codigoTel } });
    setEsperandoCodigo(false);
    setCodigoTel('');
    await session.refreshMe();
  });
  const cerrarSesion = useOrgMutation<string>((id, req) => req(`/v1/auth/sessions/${id}`, { method: 'DELETE' }).then(() => undefined));
  const cerrarOtras = useOrgMutation<void, { closed: number }>((_v, req) => req('/v1/auth/sessions/revoke-others', { method: 'POST' }));

  if (!me) return <Loading />;
  const error = iniciar2fa.error ?? activar2fa.error ?? quitar2fa.error ?? pedirCodigo.error ?? verificarTel.error ?? cerrarSesion.error ?? cerrarOtras.error ?? sesiones.error;

  return (
    <section className="rs-panel setting-panel">
      <h2 className="h2 h2--lg setting-panel__title">Seguridad</h2>
      {ok && <OkNote>{ok}</OkNote>}
      <ErrorNote error={error} />

      <Ajuste
        t="Verificación en dos pasos"
        d={
          me.twoFactorEnabled
            ? 'Activa. Al entrar te pedimos el código de tu app de autenticación (Google Authenticator, Authy…).'
            : me.twoFactorRequired
              ? 'Obligatoria para tu rol: sin ella no puedes aprobar pagos, anunciar ganadores ni manejar el equipo.'
              : 'Recomendada: protege tu cuenta aunque alguien conozca tu contraseña.'
        }
      >
        {me.twoFactorEnabled ? (
          <Badge tono="abierto">Activa</Badge>
        ) : (
          !setup && (
            <button type="button" className="rs-btn rs-btn--primario rs-btn--sm" disabled={iniciar2fa.isPending} onClick={() => iniciar2fa.mutate()}>
              Activar
            </button>
          )
        )}
      </Ajuste>
      {setup && !me.twoFactorEnabled && (
        <div className="seguridad-2fa">
          <img src={setup.qr} alt="Código QR para tu app de autenticación" width={200} height={200} />
          <div className="stack" style={{ gap: 10 }}>
            <p className="rs-help" style={{ margin: 0 }}>
              1. Escanea el código con tu app de autenticación (o escribe la clave <b className="rs-mono">{setup.secret}</b>).<br />
              2. Escribe el código de 6 dígitos que muestra la app.
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <input className="rs-in rs-mono" style={{ width: 140, textAlign: 'center', letterSpacing: '.2em' }} inputMode="numeric" maxLength={6} aria-label="Código de 6 dígitos" value={codigo} onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ''))} />
              <button type="button" className="rs-btn rs-btn--primario" disabled={codigo.length !== 6 || activar2fa.isPending} onClick={() => activar2fa.mutateAsync().then(() => setOk('Verificación en dos pasos activada.')).catch(() => undefined)}>
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}
      {me.twoFactorEnabled && !me.twoFactorRequired && (
        <Ajuste t="Desactivar la verificación en dos pasos" d="Te pedimos tu contraseña y un código vigente.">
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <input className="rs-in" type="password" style={{ width: 170 }} placeholder="Contraseña" aria-label="Contraseña" value={desactivar.password} onChange={(e) => setDesactivar({ ...desactivar, password: e.target.value })} />
            <input className="rs-in rs-mono" style={{ width: 110 }} inputMode="numeric" maxLength={6} placeholder="Código" aria-label="Código" value={desactivar.code} onChange={(e) => setDesactivar({ ...desactivar, code: e.target.value.replace(/\D/g, '') })} />
            <button type="button" className="rs-btn rs-btn--secundario rs-btn--sm" style={{ color: 'var(--rojo-texto)' }} disabled={quitar2fa.isPending || desactivar.code.length !== 6 || !desactivar.password} onClick={() => quitar2fa.mutateAsync().then(() => setOk('Verificación en dos pasos desactivada.')).catch(() => undefined)}>
              Desactivar
            </button>
          </div>
        </Ajuste>
      )}

      <Ajuste
        t="Tu WhatsApp para avisos"
        d={
          me.phoneVerified && me.phone
            ? `Verificado: ${formatPhone(me.phone)}. Aquí te llegan el resultado de LoteríaYa y los ganadores de tus sorteos.`
            : 'Verifícalo para recibir por WhatsApp el resultado de LoteríaYa y los ganadores de tus sorteos (también te llegan por correo).'
        }
      >
        {!esperandoCodigo && (
          <div style={{ display: 'flex', gap: 8 }}>
            <input className="rs-in rs-mono" style={{ width: 170 }} inputMode="tel" placeholder="300 123 4567" aria-label="Tu WhatsApp" value={telefono} onChange={(e) => setTelefono(e.target.value)} />
            <button
              type="button"
              className="rs-btn rs-btn--secundario rs-btn--sm"
              disabled={pedirCodigo.isPending || telefono.replace(/\D/g, '').length < 7}
              onClick={() =>
                pedirCodigo
                  .mutateAsync()
                  .then((r) => {
                    setEsperandoCodigo(true);
                    setOk(r.devCode ? `Código enviado. En desarrollo (sin WhatsApp real) es ${r.devCode}.` : 'Te enviamos un código por WhatsApp.');
                  })
                  .catch(() => undefined)
              }
            >
              {me.phoneVerified ? 'Cambiar' : 'Enviar código'}
            </button>
          </div>
        )}
        {esperandoCodigo && (
          <div style={{ display: 'flex', gap: 8 }}>
            <input className="rs-in rs-mono" style={{ width: 120, textAlign: 'center' }} inputMode="numeric" maxLength={6} placeholder="000000" aria-label="Código recibido" value={codigoTel} onChange={(e) => setCodigoTel(e.target.value.replace(/\D/g, ''))} />
            <button type="button" className="rs-btn rs-btn--primario rs-btn--sm" disabled={codigoTel.length !== 6 || verificarTel.isPending} onClick={() => verificarTel.mutateAsync().then(() => setOk('WhatsApp verificado.')).catch(() => undefined)}>
              Verificar
            </button>
          </div>
        )}
      </Ajuste>

      <Ajuste t="Sesiones abiertas" d="Equipos donde tu cuenta tiene la sesión iniciada. Si no reconoces alguno, ciérralo y cambia tu contraseña.">
        <button
          type="button"
          className="rs-btn rs-btn--secundario rs-btn--sm"
          disabled={cerrarOtras.isPending || (sesiones.data?.length ?? 0) < 2}
          onClick={() => cerrarOtras.mutateAsync().then((r) => setOk(`Cerramos ${r.closed} ${r.closed === 1 ? 'sesión' : 'sesiones'}.`)).catch(() => undefined)}
        >
          Cerrar las demás
        </button>
      </Ajuste>
      <div className="list-card" style={{ margin: '0 24px 24px' }}>
        {sesiones.isLoading && <Loading />}
        {(sesiones.data ?? []).map((x) => (
          <div key={x.id} className="list-row" style={{ justifyContent: 'space-between' }}>
            <span>
              <b>{x.device}</b> {x.current && <Badge tono="abierto">Este equipo</Badge>}
              <br />
              <span className="cell-sub">Desde {formatDay(x.startedAt)} · activa {timeAgo(x.lastUsedAt)}{x.ip ? ` · IP ${x.ip}` : ''}</span>
            </span>
            {!x.current && (
              <button type="button" className="rs-btn rs-btn--fantasma rs-btn--sm" style={{ color: 'var(--rojo-texto)' }} onClick={() => cerrarSesion.mutateAsync(x.id).then(() => setOk('Sesión cerrada.')).catch(() => undefined)}>
                Cerrar
              </button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
