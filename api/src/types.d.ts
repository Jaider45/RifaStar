import type { AuthPrincipal } from './auth/auth.types';
import type { OrgContext } from './tenancy/org-context';

declare global {
  namespace Express {
    interface Request {
      auth?: AuthPrincipal;
      org?: OrgContext;
      requestId?: string;
    }
  }
}

export {};
