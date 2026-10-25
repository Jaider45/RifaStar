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
  twoFactorEnabled: boolean;
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
  anticipatedDrawAt: string | null;
}

export type RaffleStatus = 'draft' | 'active' | 'sold_out' | 'closed' | 'drawn' | 'cancelled';

export interface Raffle {
  id: string;
  sequence: number;
  slug: string;
  publicUrl: string;
  title: string;
  lottery: string;
  drawAt: string;
  salesCloseAt: string | null;
  pricePerNumber: number;
  digits: 2 | 3 | 4;
  totalNumbers: number;
  minPerOrder: number;
  accentColor: string | null;
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
}

export interface Upload {
  url: string;
  fields: Record<string, string>;
  key: string;
  expiresAt: string;
  maxBytes: number;
}
