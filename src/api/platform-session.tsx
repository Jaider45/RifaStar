import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { request, type RequestOptions } from './client';

export interface PlatformMe {
  id: string;
  email: string;
  name: string;
  role: 'super_admin' | 'support' | 'finance';
  permissions: string[];
}

interface PlatformState {
  status: 'loading' | 'anon' | 'user';
  me: PlatformMe | null;
  /** Paso 1: contraseña → token de desafío. */
  login: (email: string, password: string) => Promise<{ challengeToken: string; needsEnrollment: boolean }>;
  enroll: (challengeToken: string) => Promise<{ otpauthUrl: string; secret: string }>;
  /** Paso 2: código TOTP → sesión. */
  verify: (challengeToken: string, code: string) => Promise<void>;
  logout: () => Promise<void>;
  can: (permission: string) => boolean;
  platformRequest: <T>(path: string, opts?: RequestOptions) => Promise<T>;
}

const PlatformContext = createContext<PlatformState | null>(null);

/** Sesión de la plataforma (super admin, soporte, finanzas). 2FA obligatorio. */
export function PlatformSessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<PlatformState['status']>('loading');
  const [me, setMe] = useState<PlatformMe | null>(null);
  const token = useRef<string | null>(null);
  const refreshing = useRef<Promise<string | null> | null>(null);

  const refresh = useCallback((): Promise<string | null> => {
    refreshing.current ??= request<{ accessToken: string }>('/v1/platform/auth/refresh', { method: 'POST' })
      .then((r) => (token.current = r.accessToken))
      .catch(() => (token.current = null))
      .finally(() => (refreshing.current = null));
    return refreshing.current;
  }, []);

  const loadMe = useCallback(async () => {
    setMe(await request<PlatformMe>('/v1/platform/me', { token: token.current, onUnauthorized: refresh }));
    setStatus('user');
  }, [refresh]);

  useEffect(() => {
    refresh().then((t) => (t ? loadMe().catch(() => setStatus('anon')) : setStatus('anon')));
  }, [refresh, loadMe]);

  const value = useMemo<PlatformState>(
    () => ({
      status,
      me,
      login: (email, password) => request('/v1/platform/auth/login', { body: { email, password } }),
      enroll: (challengeToken) => request('/v1/platform/auth/2fa/enroll', { body: { challengeToken } }),
      verify: async (challengeToken, code) => {
        const r = await request<{ accessToken: string }>('/v1/platform/auth/2fa/verify', { body: { challengeToken, code } });
        token.current = r.accessToken;
        await loadMe();
      },
      logout: async () => {
        await request('/v1/platform/auth/logout', { method: 'POST' }).catch(() => undefined);
        token.current = null;
        setMe(null);
        setStatus('anon');
      },
      can: (permission) => Boolean(me?.permissions.includes(permission)),
      platformRequest: <T,>(path: string, opts: RequestOptions = {}) =>
        request<T>(path, { ...opts, token: token.current, onUnauthorized: refresh }),
    }),
    [status, me, loadMe, refresh],
  );

  return <PlatformContext.Provider value={value}>{children}</PlatformContext.Provider>;
}

export function usePlatform(): PlatformState {
  const ctx = useContext(PlatformContext);
  if (!ctx) throw new Error('usePlatform debe usarse dentro de <PlatformSessionProvider>');
  return ctx;
}
