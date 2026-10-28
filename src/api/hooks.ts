import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type UseQueryOptions } from '@tanstack/react-query';
import { request, type RequestOptions } from './client';
import { usePlatform } from './platform-session';
import { useSession } from './session';
import type { OrgProfile } from './types';

/** GET autenticado del panel (la clave incluye la organización activa). */
export function useOrgQuery<T>(path: string | null, options: Partial<UseQueryOptions<T>> = {}) {
  const { orgRequest, activeOrgId, status } = useSession();
  return useQuery<T>({
    queryKey: ['org', activeOrgId, path],
    queryFn: () => orgRequest<T>(path!),
    enabled: Boolean(path && activeOrgId && (status === 'user' || status === 'support')),
    ...options,
  });
}

/** Lista paginada del panel ({ items, nextCursor }): las páginas se acumulan con «Cargar más». */
export function useOrgPages<T, P extends { items: T[]; nextCursor: string | null }>(path: string | null) {
  const { orgRequest, activeOrgId, status } = useSession();
  const q = useInfiniteQuery<P>({
    queryKey: ['org', activeOrgId, path, 'pages'],
    queryFn: ({ pageParam }) => orgRequest<P>(`${path}${path!.includes('?') ? '&' : '?'}${pageParam ? `cursor=${pageParam}` : ''}`),
    initialPageParam: null,
    getNextPageParam: (last) => last.nextCursor,
    enabled: Boolean(path && activeOrgId && (status === 'user' || status === 'support')),
  });
  return { ...q, items: q.data?.pages.flatMap((p) => p.items), first: q.data?.pages[0] };
}

/** Mutación del panel; al terminar invalida las consultas de la organización. */
export function useOrgMutation<V = void, R = unknown>(fn: (v: V, req: <T>(p: string, o?: RequestOptions) => Promise<T>) => Promise<R>) {
  const { orgRequest } = useSession();
  const qc = useQueryClient();
  return useMutation<R, Error, V>({
    mutationFn: (v) => fn(v, orgRequest),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['org'] }),
  });
}

/** Perfil de la organización activa + permisos de quien la ve. */
export function useOrgProfile() {
  return useOrgQuery<OrgProfile>('/v1/organization', { staleTime: 30_000 });
}

export function useCan() {
  const { data } = useOrgProfile();
  return (permission: string) => Boolean(data && !data.viewer.readOnly && data.viewer.permissions.includes(permission));
}

export function usePublicQuery<T>(path: string | null, options: Partial<UseQueryOptions<T>> = {}) {
  return useQuery<T>({ queryKey: ['public', path], queryFn: () => request<T>(path!), enabled: Boolean(path), ...options });
}

export function usePlatformQuery<T>(path: string | null, options: Partial<UseQueryOptions<T>> = {}) {
  const { platformRequest, status } = usePlatform();
  return useQuery<T>({
    queryKey: ['platform', path],
    queryFn: () => platformRequest<T>(path!),
    enabled: Boolean(path && status === 'user'),
    ...options,
  });
}

export function usePlatformMutation<V = void, R = unknown>(fn: (v: V, req: <T>(p: string, o?: RequestOptions) => Promise<T>) => Promise<R>) {
  const { platformRequest } = usePlatform();
  const qc = useQueryClient();
  return useMutation<R, Error, V>({
    mutationFn: (v) => fn(v, platformRequest),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['platform'] }),
  });
}
