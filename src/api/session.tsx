import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ApiError, request, sessionHint, type RequestOptions } from './client';
import type { Me } from './types';

const HINT_KEY = 'rs_session';

/** Sesión de soporte de la plataforma (solo lectura) guardada para el panel. */
export interface SupportSession {
  token: string;
  organizationId: string;
  organizationName: string;
  expiresAt: string;
  sessionId: string;
}

const ORG_KEY = 'rs_org';
const SUPPORT_KEY = 'rs_support';

interface SessionState {
  status: 'loading' | 'anon' | 'user' | 'support';
  me: Me | null;
  support: SupportSession | null;
  activeOrgId: string | null;
  setActiveOrg: (id: string) => void;
  login: (email: string, password: string, totpCode?: string) => Promise<void>;
  signup: (input: { name: string; email: string; password: string; organization: { name: string; slug: string } }) => Promise<void>;
  acceptSession: (accessToken: string, organizationId?: string) => Promise<void>;
  logout: () => Promise<void>;
  startSupport: (s: SupportSession) => void;
  endSupport: () => void;
  refreshMe: () => Promise<void>;
  /** Mientras soporte de la plataforma esté dentro de la cuenta (cabecera X-Support-Active). */
  supportActiveUntil: string | null;
  /** Estado de la cuenta según la API (cabecera X-Account-Status). */
  accountStatus: string | null;
  /** Llamada autenticada al panel (agrega el token y la organización activa). */
  orgRequest: <T>(path: string, opts?: RequestOptions) => Promise<T>;
}

const SessionContext = createContext<SessionState | null>(null);

function readSupport(): SupportSession | null {
  try {
    const raw = sessionStorage.getItem(SUPPORT_KEY);
    const s = raw ? (JSON.parse(raw) as SupportSession) : null;
    return s && new Date(s.expiresAt).getTime() > Date.now() ? s : null;
  } catch {
    return null;
  }
}

/**
 * Sesión del panel de organización. El access token vive solo en memoria; el
 * refresh token va en una cookie httpOnly que el navegador envía a /v1/auth.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SessionState['status']>('loading');
  const [me, setMe] = useState<Me | null>(null);
  const [support, setSupport] = useState<SupportSession | null>(readSupport);
  const [activeOrgId, setActiveOrgId] = useState<string | null>(() => localStorage.getItem(ORG_KEY));
  const [supportActiveUntil, setSupportActiveUntil] = useState<string | null>(null);
  const [accountStatus, setAccountStatus] = useState<string | null>(null);
  const token = useRef<string | null>(null);
  const setToken = (t: string | null) => {
    token.current = t;
    sessionHint.set(HINT_KEY, Boolean(t));
    return t;
  };
  const refreshing = useRef<Promise<string | null> | null>(null);

  const readHeaders = useCallback((res: Response) => {
    const active = res.headers.get('X-Support-Active');
    setSupportActiveUntil(active ? active.replace('expires=', '') : null);
    const st = res.headers.get('X-Account-Status');
    if (st) setAccountStatus(st);
  }, []);

  const refresh = useCallback((): Promise<string | null> => {
    refreshing.current ??= request<{ accessToken: string }>('/v1/auth/refresh', { method: 'POST' })
      .then((r) => setToken(r.accessToken))
      .catch((err) => {
        token.current = null;
        if (err instanceof ApiError) sessionHint.set(HINT_KEY, false);
        return null;
      })
      .finally(() => (refreshing.current = null));
    return refreshing.current;
  }, []);

  const loadMe = useCallback(async () => {
    const data = await request<Me>('/v1/auth/me', { token: token.current, onUnauthorized: refresh });
    setMe(data);
    setActiveOrgId((cur) => {
      const valid = data.memberships.find((m) => m.organization.id === cur);
      const next = valid ? cur : (data.memberships[0]?.organization.id ?? null);
      if (next) localStorage.setItem(ORG_KEY, next);
      return next;
    });
    setStatus('user');
  }, [refresh]);

  useEffect(() => {
    if (support) {
      setStatus('support');
      return;
    }
    if (!sessionHint.has(HINT_KEY)) {
      setStatus('anon');
      return;
    }
    refresh().then((t) => (t ? loadMe().catch(() => setStatus('anon')) : setStatus('anon')));
  }, [support, refresh, loadMe]);

  const value = useMemo<SessionState>(() => {
    const supportActive = support && new Date(support.expiresAt).getTime() > Date.now() ? support : null;
    return {
      status,
      me,
      support: supportActive,
      supportActiveUntil,
      accountStatus,
      activeOrgId: supportActive?.organizationId ?? activeOrgId,
      setActiveOrg: (id) => {
        localStorage.setItem(ORG_KEY, id);
        setAccountStatus(null);
        setActiveOrgId(id);
      },
      login: async (email, password, totpCode) => {
        const r = await request<{ accessToken: string }>('/v1/auth/login', { body: { email, password, totpCode } });
        setToken(r.accessToken);
        await loadMe();
      },
      signup: async (input) => {
        const r = await request<{ accessToken: string; organizationId: string }>('/v1/auth/signup', { body: input });
        setToken(r.accessToken);
        localStorage.setItem(ORG_KEY, r.organizationId);
        setActiveOrgId(r.organizationId);
        await loadMe();
      },
      acceptSession: async (accessToken, organizationId) => {
        setToken(accessToken);
        if (organizationId) {
          localStorage.setItem(ORG_KEY, organizationId);
          setActiveOrgId(organizationId);
        }
        await loadMe();
      },
      logout: async () => {
        await request('/v1/auth/logout', { method: 'POST' }).catch(() => undefined);
        setToken(null);
        setMe(null);
        setStatus('anon');
      },
      startSupport: (s) => {
        sessionStorage.setItem(SUPPORT_KEY, JSON.stringify(s));
        setSupport(s);
      },
      endSupport: () => {
        sessionStorage.removeItem(SUPPORT_KEY);
        setSupport(null);
      },
      refreshMe: loadMe,
      orgRequest: <T,>(path: string, opts: RequestOptions = {}) => {
        const orgId = supportActive?.organizationId ?? activeOrgId;
        if (supportActive) {
          return request<T>(path, {
            ...opts,
            onResponse: readHeaders,
            token: supportActive.token,
            headers: { 'X-Organization-Id': supportActive.organizationId, ...opts.headers },
          }).catch((err) => {
            if (err instanceof ApiError && err.status === 401) {
              sessionStorage.removeItem(SUPPORT_KEY);
              setSupport(null);
            }
            throw err;
          });
        }
        return request<T>(path, {
          ...opts,
          onResponse: readHeaders,
          token: token.current,
          onUnauthorized: refresh,
          headers: { ...(orgId && { 'X-Organization-Id': orgId }), ...opts.headers },
        });
      },
    };
  }, [status, me, support, activeOrgId, loadMe, refresh, readHeaders, supportActiveUntil, accountStatus]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession debe usarse dentro de <SessionProvider>');
  return ctx;
}
