import { Link } from 'react-router-dom';
import { Icon } from '@/components/Icon';
import { Logo } from '@/components/Logo';
import { PubFrame } from '@/components/PubFrame';
import { ErrorNote, Loading } from '@/components/ui';
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

export interface PublicRaffle {
  organization: { name: string; slug: string; supportWhatsapp: string | null; logoUrl: string | null; showRifaStarBadge: boolean; rafflesCompleted: number; timezone: string };
  raffle: {
    slug: string;
    title: string;
    lottery: string;
    drawAt: string;
    salesCloseAt: string | null;
    coverUrl: string | null;
    pricePerNumber: number;
    digits: number;
    totalNumbers: number;
    minPerOrder: number;
    accentColor: string;
    conditionText: string | null;
    authorizationNumber: string | null;
    status: string;
    resultsPublished: boolean;
  };
  prizes: { position: number; amountCop: number | null; description: string | null; ruleLabel: string }[];
  progress: { paid: number; held: number; available: number; soldPercent: number };
  paymentAccounts: { id: string; type: string; typeLabel: string; keyOrNumber: string; holderName: string; bankName: string | null; accountKind: string | null }[];
  serverTime: string;
}

/** Encabezado público con el logo, soporte por WhatsApp y «Mis boletos». */
export function PubHeader({ org, misBoletos = true }: { org: { slug: string; supportWhatsapp: string | null; logoUrl?: string | null }; misBoletos?: boolean }) {
  return (
    <header className="pub-header">
      <Link to={`/${org.slug}`} aria-label="Inicio de la organización" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Logo variante="blanco" className="pub-header__logo" />
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
