import type { PlatformRole } from '@prisma/client';

export type AuthPrincipal =
  | { kind: 'user'; userId: string }
  | { kind: 'platform'; platformUserId: string; role: PlatformRole }
  | { kind: 'support'; platformUserId: string; organizationId: string; supportSessionId: string; expiresAt: Date }
  | { kind: 'participant'; participantId: string; organizationId: string };

export type AccessClaims =
  | { typ: 'user'; sub: string }
  | { typ: 'platform'; sub: string; role: PlatformRole }
  | { typ: 'support'; sub: string; org: string; sid: string; ro: true }
  | { typ: 'platform_challenge'; sub: string };

export interface ParticipantClaims {
  typ: 'participant';
  sub: string;
  org: string;
}
