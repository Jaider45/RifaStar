import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '@/components/Icon';
import { Logo } from '@/components/Logo';
import { PubFrame } from '@/components/PubFrame';
import { ErrorNote, Loading } from '@/components/ui';
import type { PageConfig } from '@/api/types';
import { waLink } from '@/lib/phone';

export interface PublicOrg {
  name: string;
  slug: string;
  supportWhatsapp: string | null;
  accentColor: string;
  logoUrl: string | null;
  showRifaStarBadge: boolean;
  rankingEnabled: boolean;
  rafflesCompleted: number;
  timezone: string;
  nextRaffle: PublicRaffleCard | null;
  raffles: PublicRaffleCard[];
}

export interface PublicRaffleCard {
  slug: string;
  title: string;
  lottery: string;
  drawAt: string;
  status: string;
  pricePerNumber: number;
  digits: number;
  progress: { paid: number; total: number };
  coverUrl: string | null;
  resultsPublished: boolean;
}

export interface SocialLinks {
  instagram: string | null;
  facebook: string | null;
  tiktok: string | null;
}

export interface PublicRaffle {
  organization: {
    name: string;
    slug: string;
    supportWhatsapp: string | null;
    logoUrl: string | null;
    showRifaStarBadge: boolean;
    rafflesCompleted: number;
    timezone: string;
    rankingEnabled: boolean;
    social: SocialLinks;
  };
  raffle: {
    slug: string;
    title: string;
    lottery: string;
    drawAt: string;
    salesCloseAt: string | null;
    coverUrl: string | null;
    gallery: string[];
    pricePerNumber: number;
    digits: number;
    totalNumbers: number;
    minPerOrder: number;
    numberSelection: 'choose' | 'random';
    unitLabel: string;
    unitLabelPlural: string;
    extraDigitsSource: 'series' | 'fifth_digit' | null;
    extraDigitsPosition: 'start' | 'end';
    accentColor: string;
    conditionText: string | null;
    authorizationNumber: string | null;
    status: string;
    resultsPublished: boolean;
    page: PageConfig;
  };
  prizes: { position: number; amountCop: number | null; description: string | null; ruleLabel: string; imageUrl: string | null }[];
  progress: { paid: number; held: number; available: number; soldPercent: number };
  paymentAccounts: { id: string; type: string; typeLabel: string; keyOrNumber: string; holderName: string; bankName: string | null; accountKind: string | null }[];
  serverTime: string;
}

/** Encabezado público con el logo, soporte por WhatsApp y «Mis boletos». */
/**
 * Cómo llama el organizador a cada unidad («número», «boleta», «puesto»…), con el género
 * para concordar los textos: «¿Cuántas boletas?», «Tus números están apartados».
 */
export function unidadDe(r: { unitLabel?: string; unitLabelPlural?: string }) {
  const s = r.unitLabel || 'número';
  const p = r.unitLabelPlural || 'números';
  const fem = s.endsWith('a');
  return { s, p, n: (k: number) => (k === 1 ? s : p), o: fem ? 'a' : 'o', los: fem ? 'las' : 'los', P: p.charAt(0).toUpperCase() + p.slice(1) };
}

export function PubHeader({
  org,
  misBoletos = true,
  tema = 'dark',
}: {
  org: { slug: string; supportWhatsapp: string | null; logoUrl?: string | null };
  misBoletos?: boolean;
  tema?: 'dark' | 'light';
}) {
  return (
    <header className="pub-header">
      <Link to={`/${org.slug}`} aria-label="Inicio de la organización" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Logo variante={tema === 'light' ? 'negro' : 'blanco'} className="pub-header__logo" />
        {org.logoUrl && <img src={org.logoUrl} alt="" width={36} height={36} style={{ borderRadius: 10, objectFit: 'cover' }} />}
      </Link>
      <div style={{ display: 'flex', gap: 8 }}>
        {org.supportWhatsapp && (
          <a href={waLink(org.supportWhatsapp)} className="rs-btn rs-btn--secundario rs-btn--sm icon-btn" aria-label="Soporte por WhatsApp" target="_blank" rel="noreferrer">
            <Icon name="whatsappFull" />
          </a>
        )}
        {misBoletos && (
          <Link to={`/${org.slug}/mis-boletos`} className="rs-btn rs-btn--secundario rs-btn--sm" style={{ minHeight: 44 }}>
            <Icon name="ticket" size={18} />
            Mis boletos
          </Link>
        )}
      </div>
    </header>
  );
}

export function PubFooter({ show = true }: { show?: boolean }) {
  if (!show) return null;
  return (
    <footer className="pub-footer">
      <Logo variante="mark" height={18} decorativo />
      Sorteo creado con Rifa Star
    </footer>
  );
}

export function PubLoading() {
  return (
    <PubFrame>
      <Loading />
    </PubFrame>
  );
}

export function PubError({ error }: { error: unknown }) {
  return (
    <PubFrame>
      <main className="pub-main">
        <ErrorNote error={error} />
        <Link to="/" className="rs-btn rs-btn--secundario">Volver</Link>
      </main>
    </PubFrame>
  );
}

/** Orden guardada en este navegador (para volver al pago o a «Mis boletos»). */
export interface StoredOrder { orderId: string; accessToken: string }
const orderKey = (org: string, sorteo: string) => `rs_order_${org}_${sorteo}`;
export const readOrder = (org: string, sorteo: string): StoredOrder | null => {
  try {
    return JSON.parse(localStorage.getItem(orderKey(org, sorteo)) ?? 'null');
  } catch {
    return null;
  }
};
export const saveOrder = (org: string, sorteo: string, o: StoredOrder) => localStorage.setItem(orderKey(org, sorteo), JSON.stringify(o));
export const clearOrder = (org: string, sorteo: string) => localStorage.removeItem(orderKey(org, sorteo));

/** Código de vendedor (?v=) y de referido (?ref=) del enlace, guardados para la compra. */
export function rememberLinkCodes(org: string, search: URLSearchParams) {
  const v = search.get('v');
  const ref = search.get('ref');
  if (v) sessionStorage.setItem(`rs_v_${org}`, v.toUpperCase());
  if (ref) sessionStorage.setItem(`rs_ref_${org}`, ref.toUpperCase());
}
export const linkCodes = (org: string) => ({
  sellerCode: sessionStorage.getItem(`rs_v_${org}`) ?? undefined,
  referralCode: sessionStorage.getItem(`rs_ref_${org}`) ?? undefined,
});

/** Redes del organizador (enlaces ya validados por la API: solo https de cada red). */
export function RedesOrganizador({ social }: { social: SocialLinks }) {
  const redes = (
    [
      ['instagram', 'Instagram', social.instagram],
      ['facebook', 'Facebook', social.facebook],
      ['tiktok', 'TikTok', social.tiktok],
    ] as const
  ).filter(([, , url]) => Boolean(url));
  if (redes.length === 0) return null;
  return (
    <div className="redes" aria-label="Redes del organizador">
      {redes.map(([icon, label, url]) => (
        <a key={icon} href={url!} target="_blank" rel="noreferrer noopener" className="rs-btn rs-btn--secundario rs-btn--sm" aria-label={label}>
          <Icon name={icon} size={18} />
          {label}
        </a>
      ))}
    </div>
  );
}

/** Formato en línea: **negrita**, *cursiva* y [texto](https://…). Nunca interpreta HTML. */
function enLinea(texto: string, base: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|\*([^*]+)\*|\[([^\]]+)\]\((https:\/\/[^\s)]+)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(texto))) {
    if (m.index > last) out.push(texto.slice(last, m.index));
    const k = `${base}-${i++}`;
    if (m[1]) out.push(<b key={k}>{m[1]}</b>);
    else if (m[2]) out.push(<em key={k}>{m[2]}</em>);
    else out.push(<a key={k} href={m[4]} target="_blank" rel="noreferrer noopener nofollow">{m[3]}</a>);
    last = re.lastIndex;
  }
  if (last < texto.length) out.push(texto.slice(last));
  return out;
}

/** Descripción del organizador: párrafos y listas con «- ». Seguro: arma elementos de React, no HTML. */
export function TextoConFormato({ texto }: { texto: string }) {
  const bloques = texto.replace(/\r/g, '').split(/\n{2,}/);
  return (
    <div className="texto-formato">
      {bloques.map((b, i) => {
        const lineas = b.split('\n').filter((l) => l.trim());
        if (lineas.length > 0 && lineas.every((l) => /^\s*[-•]\s+/.test(l))) {
          return (
            <ul key={i}>
              {lineas.map((l, j) => <li key={j}>{enLinea(l.replace(/^\s*[-•]\s+/, ''), `${i}-${j}`)}</li>)}
            </ul>
          );
        }
        return (
          <p key={i}>
            {lineas.map((l, j) => (
              <span key={j}>
                {j > 0 && <br />}
                {enLinea(l, `${i}-${j}`)}
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}
