import { useEffect, useState } from 'react';
import { usePlatformMutation, usePlatformQuery } from '@/api/hooks';
import { usePlatform } from '@/api/platform-session';
import { Badge } from '@/components/Badge';
import { Icon } from '@/components/Icon';
import { PageHeader } from '@/components/PageHeader';
import { ErrorNote, Loading, Modal, OkNote } from '@/components/ui';
import './plataforma.css';

interface Plan {
  id: string;
  code: string;
  name: string;
  monthlyPriceCop: number;
  maxActiveRaffles: number | null;
  maxMembers: number;
  monthlyWhatsappMessages: number;
  featureRanking: boolean;
  featureWhatsappAuto: boolean;
  featureSellers: boolean;
  featureCustomRoles: boolean;
  featureCustomDomain: boolean;
  featureWhiteLabel: boolean;
  externalPriceIds: Record<string, string>;
  highlighted: boolean;
  sortOrder: number;
  archivedAt: string | null;
  subscribers: number;
}

interface TrialConfig {
  planCode: string;
  days: number;
  onExpire: 'downgrade_to_plan' | 'block_new_raffles';
  downgradePlanCode: string | null;
  pastDueGraceDays: number;
}

type FeatureKey = 'featureRanking' | 'featureWhatsappAuto' | 'featureSellers' | 'featureCustomRoles' | 'featureCustomDomain' | 'featureWhiteLabel';

const FUNCIONES: [FeatureKey, string][] = [
  ['featureRanking', 'Ranking mensual con enlace público'],
  ['featureWhatsappAuto', 'Notificaciones automáticas por WhatsApp'],
  ['featureSellers', 'Vendedores con código'],
  ['featureCustomRoles', 'Roles personalizados'],
  ['featureCustomDomain', 'Dominio propio'],
  ['featureWhiteLabel', 'Quitar «Creado con Rifa Star»'],
];

const EDITABLES = ['name', 'monthlyPriceCop', 'maxActiveRaffles', 'maxMembers', 'monthlyWhatsappMessages', 'highlighted', 'sortOrder', ...FUNCIONES.map(([k]) => k)] as const;

const num = (v: string) => (v.trim() === '' ? 0 : Math.max(0, Math.floor(Number(v.replace(/\D/g, '')) || 0)));

function NuevoPlan({ onClose }: { onClose: () => void }) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [precio, setPrecio] = useState('');
  const crear = usePlatformMutation<void>((_, req) =>
    req('/v1/platform/plans', {
      body: {
        code,
        name: name.trim(),
        monthlyPriceCop: num(precio),
        maxActiveRaffles: 1,
        maxMembers: 1,
        monthlyWhatsappMessages: 0,
        featureRanking: false,
        featureWhatsappAuto: false,
        featureSellers: false,
        featureCustomRoles: false,
        featureCustomDomain: false,
        featureWhiteLabel: false,
      },
    }),
  );
  return (
    <Modal
      title="Nuevo plan"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="rs-btn rs-btn--secundario" onClick={onClose}>Cancelar</button>
          <button type="button" className="rs-btn rs-btn--primario" disabled={!code || name.trim().length < 2 || crear.isPending} onClick={() => crear.mutate(undefined, { onSuccess: onClose })}>
            {crear.isPending ? 'Creando…' : 'Crear plan'}
          </button>
        </>
      }
    >
      <div className="stack" style={{ gap: 12 }}>
        <div>
          <label className="rs-label" htmlFor="np-nombre">Nombre</label>
          <input id="np-nombre" className="rs-in" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="rs-label" htmlFor="np-code">Código</label>
          <input id="np-code" className="rs-in rs-mono" value={code} onChange={(e) => setCode(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))} placeholder="empresa" />
          <p className="rs-help">No se puede cambiar después. Solo minúsculas, números y guiones.</p>
        </div>
        <div>
          <label className="rs-label" htmlFor="np-precio">Precio mensual (COP)</label>
          <input id="np-precio" className="rs-in rs-mono" inputMode="numeric" value={precio} onChange={(e) => setPrecio(e.target.value)} />
        </div>
        <p className="rs-help">Luego ajusta límites y funciones en la tabla.</p>
        <ErrorNote error={crear.error} />
      </div>
    </Modal>
  );
}

function PruebaGratis({ planes, editable }: { planes: Plan[]; editable: boolean }) {
  const trial = usePlatformQuery<TrialConfig>('/v1/platform/trial-config');
  const [t, setT] = useState<TrialConfig | null>(null);
  const [ok, setOk] = useState(false);
  useEffect(() => {
    if (trial.data) setT(trial.data);
  }, [trial.data]);
  const guardar = usePlatformMutation<TrialConfig>((v, req) => req('/v1/platform/trial-config', { method: 'PUT', body: v }));
  if (!t) return trial.error ? <ErrorNote error={trial.error} /> : null;
  const activos = planes.filter((p) => !p.archivedAt);
  return (
    <section className="rs-panel prueba">
      <div style={{ flex: '1 1 260px' }}>
        <h2 className="h2 h2--sm">Prueba gratis</h2>
        <p className="rs-help">Plan con el que empieza una organización nueva, cuántos días dura y qué pasa al vencer.</p>
      </div>
      <div>
        <label className="rs-label" htmlFor="tp">Plan de prueba</label>
        <select id="tp" className="rs-in" style={{ width: 180 }} disabled={!editable} value={t.planCode} onChange={(e) => setT({ ...t, planCode: e.target.value })}>
          {activos.map((p) => <option key={p.id} value={p.code}>{p.name}</option>)}
        </select>
      </div>
      <div>
        <label className="rs-label" htmlFor="td">Días</label>
        <input id="td" className="rs-in rs-mono" disabled={!editable} value={t.days} onChange={(e) => setT({ ...t, days: num(e.target.value) })} style={{ width: 100, textAlign: 'center' }} />
      </div>
      <div>
        <label className="rs-label" htmlFor="tf">Al vencer</label>
        <select id="tf" className="rs-in" style={{ width: 220 }} disabled={!editable} value={t.onExpire} onChange={(e) => setT({ ...t, onExpire: e.target.value as TrialConfig['onExpire'] })}>
          <option value="block_new_raffles">Pausar sorteos nuevos</option>
          <option value="downgrade_to_plan">Pasar a otro plan</option>
        </select>
      </div>
      {t.onExpire === 'downgrade_to_plan' && (
        <div>
          <label className="rs-label" htmlFor="tdp">Pasa a</label>
          <select id="tdp" className="rs-in" style={{ width: 180 }} disabled={!editable} value={t.downgradePlanCode ?? ''} onChange={(e) => setT({ ...t, downgradePlanCode: e.target.value || null })}>
            <option value="">Elige un plan</option>
            {activos.map((p) => <option key={p.id} value={p.code}>{p.name}</option>)}
          </select>
        </div>
      )}
      <div>
        <label className="rs-label" htmlFor="tg">Gracia por pago fallido</label>
        <input id="tg" className="rs-in rs-mono" disabled={!editable} value={t.pastDueGraceDays} onChange={(e) => setT({ ...t, pastDueGraceDays: num(e.target.value) })} style={{ width: 100, textAlign: 'center' }} aria-describedby="tg-h" />
        <span id="tg-h" className="sr-only">días</span>
      </div>
      {editable && (
        <button type="button" className="rs-btn rs-btn--secundario" disabled={guardar.isPending} onClick={() => { setOk(false); guardar.mutate(t, { onSuccess: () => setOk(true) }); }}>
          {guardar.isPending ? 'Guardando…' : 'Guardar prueba'}
        </button>
      )}
      <div style={{ flexBasis: '100%' }}>
        <ErrorNote error={guardar.error} />
        {ok && <OkNote>Configuración de la prueba guardada.</OkNote>}
      </div>
    </section>
  );
}

export default function Planes() {
  const { can } = usePlatform();
  const editable = can('platform.plans.write');
  const plans = usePlatformQuery<Plan[]>('/v1/platform/plans');
  const [drafts, setDrafts] = useState<Record<string, Plan>>({});
  const [nuevo, setNuevo] = useState(false);
  const [verArchivados, setVerArchivados] = useState(false);
  const [ok, setOk] = useState(false);

  useEffect(() => {
    if (plans.data) setDrafts(Object.fromEntries(plans.data.map((p) => [p.id, p])));
  }, [plans.data]);

  const cambiados = (plans.data ?? []).filter((p) => drafts[p.id] && EDITABLES.some((k) => drafts[p.id][k] !== p[k]));
  const guardar = usePlatformMutation<Plan[]>(async (list, req) => {
    for (const d of list) {
      const original = plans.data!.find((p) => p.id === d.id)!;
      const body = Object.fromEntries(EDITABLES.filter((k) => d[k] !== original[k]).map((k) => [k, d[k]]));
      await req(`/v1/platform/plans/${d.id}`, { method: 'PATCH', body });
    }
  });
  const archivar = usePlatformMutation<string>((id, req) => req(`/v1/platform/plans/${id}`, { method: 'DELETE' }));

  const set = <K extends keyof Plan>(id: string, k: K, v: Plan[K]) => {
    setOk(false);
    setDrafts((cur) => ({ ...cur, [id]: { ...cur[id], [k]: v } }));
  };

  if (plans.isLoading) return <Loading />;
  if (plans.error) return <ErrorNote error={plans.error} />;
  const visibles = (plans.data ?? []).filter((p) => verArchivados || !p.archivedAt).map((p) => drafts[p.id] ?? p);

  return (
    <>
      <PageHeader
        title="Planes"
        sub="Define precios, límites y qué funciones tiene cada plan. Los límites aplican de inmediato; el precio, en la próxima renovación."
        actions={
          editable && (
            <>
              <button type="button" className="rs-btn rs-btn--secundario" onClick={() => setNuevo(true)}>
                <Icon name="plus" size={18} strokeWidth={2.4} />
                Nuevo plan
              </button>
              <button
                type="button"
                className="rs-btn rs-btn--primario"
                disabled={cambiados.length === 0 || guardar.isPending}
                onClick={() => guardar.mutate(cambiados.map((p) => drafts[p.id]), { onSuccess: () => setOk(true) })}
              >
                {guardar.isPending ? 'Guardando…' : cambiados.length ? `Guardar ${cambiados.length} plan${cambiados.length > 1 ? 'es' : ''}` : 'Guardar planes'}
              </button>
            </>
          )
        }
      />
      <ErrorNote error={guardar.error ?? archivar.error} />
      {ok && <OkNote>Planes guardados.</OkNote>}

      <section className="planes">
        {visibles.map((p) => (
          <div key={p.id} className={`rs-panel plan${p.highlighted ? ' plan--destacado' : ''}`} style={p.archivedAt ? { opacity: 0.6 } : undefined}>
            <div className="fila-plan">
              <input className="rs-in rs-display plan__nombre" aria-label={`Nombre del plan ${p.code}`} value={p.name} disabled={!editable || Boolean(p.archivedAt)} onChange={(e) => set(p.id, 'name', e.target.value)} style={{ padding: '4px 8px' }} />
              <Badge tono={p.archivedAt ? 'cerrado' : 'abierto'}>{p.archivedAt ? 'Archivado' : `${p.subscribers} cuentas`}</Badge>
            </div>
            <span className="rs-mono cell-sub">{p.code}</span>
            <div>
              <label className="rs-label" htmlFor={`precio-${p.id}`}>Precio mensual (COP)</label>
              <input id={`precio-${p.id}`} className="rs-in rs-mono" inputMode="numeric" disabled={!editable} value={p.monthlyPriceCop} onChange={(e) => set(p.id, 'monthlyPriceCop', num(e.target.value))} />
            </div>
            <div className="plan__limites">
              <span>Sorteos activos</span>
              <input className="rs-in rs-mono" placeholder="∞" disabled={!editable} value={p.maxActiveRaffles ?? ''} aria-label={`Sorteos activos ${p.name} (vacío = ilimitado)`} onChange={(e) => set(p.id, 'maxActiveRaffles', e.target.value.trim() === '' ? null : num(e.target.value))} />
              <span>Miembros del equipo</span>
              <input className="rs-in rs-mono" disabled={!editable} value={p.maxMembers} aria-label={`Miembros ${p.name}`} onChange={(e) => set(p.id, 'maxMembers', Math.max(1, num(e.target.value)))} />
              <span>Mensajes WhatsApp / mes</span>
              <input className="rs-in rs-mono" disabled={!editable} value={p.monthlyWhatsappMessages} aria-label={`Mensajes ${p.name}`} onChange={(e) => set(p.id, 'monthlyWhatsappMessages', num(e.target.value))} />
              <span>Orden</span>
              <input className="rs-in rs-mono" disabled={!editable} value={p.sortOrder} aria-label={`Orden ${p.name}`} onChange={(e) => set(p.id, 'sortOrder', Math.min(100, num(e.target.value)))} />
            </div>
            <label className="fila-plan" style={{ font: '600 14px/20px var(--font-sans)' }}>
              Destacar como «Más elegido»
              <input type="checkbox" className="check" disabled={!editable} checked={p.highlighted} onChange={(e) => set(p.id, 'highlighted', e.target.checked)} />
            </label>
            {editable && !p.archivedAt && (
              <button type="button" className="rs-btn rs-btn--fantasma rs-btn--sm" style={{ alignSelf: 'flex-start', color: 'var(--rojo-texto)' }} disabled={archivar.isPending} onClick={() => window.confirm(`¿Archivar el plan ${p.name}? Ya no se podrá contratar.`) && archivar.mutate(p.id)}>
                Archivar plan
              </button>
            )}
          </div>
        ))}
      </section>
      {(plans.data ?? []).some((p) => p.archivedAt) && (
        <button type="button" className="rs-btn rs-btn--fantasma rs-btn--sm" style={{ alignSelf: 'flex-start' }} onClick={() => setVerArchivados((v) => !v)}>
          {verArchivados ? 'Ocultar archivados' : 'Ver planes archivados'}
        </button>
      )}

      <section className="rs-panel overflow-hidden">
        <div className="panel-head">
          <h2 className="h2">Funciones por plan</h2>
        </div>
        <div className="table-scroll">
          <table className="rs-tabla" style={{ minWidth: 640 }}>
            <thead>
              <tr>
                <th style={{ width: '46%' }}>Función</th>
                {visibles.map((p) => <th key={p.id} className="td-center">{p.name}</th>)}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Enlace público de sorteo y «Mis boletos»</td>
                {visibles.map((p) => <td key={p.id} className="td-center incluye--si">Sí</td>)}
              </tr>
              {FUNCIONES.map(([k, nombre]) => (
                <tr key={k}>
                  <td>{nombre}</td>
                  {visibles.map((p) => (
                    <td key={p.id} className="td-center">
                      <input type="checkbox" className="check" checked={p[k]} disabled={!editable || Boolean(p.archivedAt)} onChange={(e) => set(p.id, k, e.target.checked)} aria-label={`${nombre} · ${p.name}`} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <PruebaGratis planes={plans.data ?? []} editable={editable} />
      {nuevo && <NuevoPlan onClose={() => setNuevo(false)} />}
    </>
  );
}
