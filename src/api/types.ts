/** Tipos de las respuestas de la API que usa el frontend. */

export interface Membership {
  memberId: string;
  organization: { id: string; slug: string; name: string; status: string };
  role: { id: string; key: string; name: string };
  sellerCode: string | null;
  permissions: string[];
}

export interface Me {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  phoneVerified: boolean;
  twoFactorEnabled: boolean;
  /** Algún rol suyo aprueba pagos, anuncia ganadores o maneja el equipo. */
  twoFactorRequired: boolean;
  memberships: Membership[];
}

export interface OrgProfile {
  id: string;
  name: string;
  slug: string;
  supportWhatsapp: string | null;
  logoUrl: string | null;
  defaultAccentColor: string;
  customDomain: string | null;
  customDomainVerifiedAt: string | null;
  timezone: string;
  status: 'trial' | 'active' | 'past_due' | 'suspended';
  trialEndsAt: string | null;
  viewer: { memberId: string | null; roleKey: string | null; permissions: string[]; readOnly: boolean; supportSessionId: string | null };
}

export type PrizeRule =
  | 'last_two'
  | 'first_two'
  | 'middle_two'
  | 'digits_1_and_4'
  | 'anticipated_last_two'
  | 'last_three'
  | 'first_three'
  | 'full_number'
  | 'anticipated_full_number'
  | 'custom';

export interface Prize {
  id?: string;
  position: number;
  amountCop: number | null;
  description: string | null;
  rule: PrizeRule;
  ruleLabel: string;
  customRuleText?: string | null;
  anticipatedLottery: string | null;
  anticipatedDrawCode?: string | null;
  anticipatedDrawAt: string | null;
  imageKey?: string | null;
  imageUrl?: string | null;
}

export type Digits = 2 | 3 | 4 | 5 | 6;
export type NumberSelection = 'choose' | 'random';
export type ExtraDigitsSource = 'series' | 'fifth_digit';
export type ExtraDigitsPosition = 'start' | 'end';

/** Personalización de la página pública. */
export interface PageConfig {
  theme: 'dark' | 'light';
  description: string | null;
  faq: { q: string; a: string }[];
  show: { countdown: boolean; progress: boolean; remaining: boolean; organizer: boolean; ranking: boolean; social: boolean };
}

export const DEFAULT_PAGE: PageConfig = {
  theme: 'dark',
  description: null,
  faq: [],
  show: { countdown: true, progress: true, remaining: true, organizer: true, ranking: true, social: true },
};

/** Sorteo del catálogo de LoteríaYa. */
export interface DrawInfo {
  code: string;
  name: string;
  category: string;
}

export type RaffleStatus = 'draft' | 'active' | 'sold_out' | 'closed' | 'drawn' | 'cancelled';

export interface Raffle {
  id: string;
  sequence: number;
  slug: string;
  publicUrl: string;
  title: string;
  lottery: string;
  lotteryDrawCode: string | null;
  drawAt: string;
  salesCloseAt: string | null;
  pricePerNumber: number;
  digits: Digits;
  totalNumbers: number;
  minPerOrder: number;
  numberSelection: NumberSelection;
  /** Nombre de cada unidad: «número», «boleta», «puesto»… */
  unitLabel: string;
  unitLabelPlural: string;
  extraDigitsSource: ExtraDigitsSource | null;
  extraDigitsPosition: ExtraDigitsPosition;
  accentColor: string | null;
  pageConfig: PageConfig;
  gallery: { key: string; url: string }[];
  conditionText: string | null;
  authorizationNumber: string | null;
  status: RaffleStatus;
  coverUrl: string | null;
  progress: { paid: number; held: number; available: number };
  collectedCop?: number;
  prizes: Prize[];
  paymentAccountIds: string[];
  resultsPublishedAt?: string | null;
}

export interface PaymentAccount {
  id: string;
  type: 'bre_b' | 'nequi' | 'daviplata' | 'bank_transfer';
  typeLabel: string;
  keyOrNumber: string;
  holderName: string;
  bankName: string | null;
  accountKind: string | null;
}

export interface Order {
  id: string;
  status: 'reserved' | 'pending_verification' | 'approved' | 'rejected' | 'expired' | 'released';
  statusLabel: string;
  raffle: { id: string; title: string; digits: number };
  participant: { id: string; name: string; phone: string };
  numbers: string[];
  totalCop: number;
  reservedUntil: string;
  receipt: { uploadedAt: string | null; mime: string | null; size: number | null } | null;
  sellerCode: string | null;
  createdAt: string;
  rejectionReason: string | null;
  tickets: { code: string; number: string }[];
  receiptUrl?: string | null;
  /** Antifraude para quien verifica. */
  alerts?: {
    duplicateReceipt: { orderId: string; participantName: string; raffle: string; status: string; createdAt: string }[];
    ownSale: boolean;
  };
}

export interface Upload {
  url: string;
  method: 'PUT';
  headers: Record<string, string>;
  key: string;
  expiresAt: string;
  maxBytes: number;
}
