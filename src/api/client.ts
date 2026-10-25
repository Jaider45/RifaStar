/**
 * Cliente HTTP de la API de Rifa Star.
 * - En desarrollo Vite redirige /v1 a la API (ver vite.config.ts); en producción
 *   se usa VITE_API_URL o el mismo dominio.
 * - Todas las respuestas de error tienen la forma { code, message, details }.
 */
const BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export interface RequestOptions {
  method?: string;
  body?: unknown;
  token?: string | null;
  headers?: Record<string, string>;
  /** Se llama una vez si la respuesta es 401, para renovar la sesión y reintentar. */
  onUnauthorized?: () => Promise<string | null>;
  /** Devuelve el Response sin parsear (descargas). */
  raw?: boolean;
  /** Para leer cabeceras (aviso de soporte, estado de la cuenta). */
  onResponse?: (res: Response) => void;
}

export async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const send = (token: string | null | undefined) =>
    fetch(`${BASE}${path}`, {
      method: opts.method ?? (opts.body === undefined ? 'GET' : 'POST'),
      credentials: 'include',
      headers: {
        ...(opts.body !== undefined && { 'Content-Type': 'application/json' }),
        ...(token && { Authorization: `Bearer ${token}` }),
        ...opts.headers,
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });

  let res: Response;
  try {
    res = await send(opts.token);
    if (res.status === 401 && opts.onUnauthorized) {
      const fresh = await opts.onUnauthorized();
      if (fresh) res = await send(fresh);
    }
  } catch {
    throw new ApiError(0, 'NETWORK', 'No hay conexión con el servidor. Revisa tu internet e intenta de nuevo.');
  }

  opts.onResponse?.(res);
  if (opts.raw && res.ok) return res as unknown as T;
  if (res.status === 204 || res.status === 304) return undefined as T;
  const text = await res.text();
  const data = text ? safeJson(text) : undefined;
  if (!res.ok) {
    const err = (data ?? {}) as { code?: string; message?: string; details?: unknown };
    throw new ApiError(res.status, err.code ?? 'HTTP_ERROR', err.message ?? 'Algo salió mal. Intenta de nuevo.', err.details);
  }
  return data as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Mensaje para mostrar al usuario a partir de cualquier error. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Algo salió mal. Intenta de nuevo.';
}

/** Sube un archivo con la URL firmada (POST multipart directo al almacenamiento). */
export async function uploadToStorage(upload: { url: string; fields: Record<string, string> }, file: File): Promise<void> {
  const form = new FormData();
  for (const [k, v] of Object.entries(upload.fields)) form.append(k, v);
  form.append('file', file);
  let res: Response;
  try {
    res = await fetch(upload.url, { method: 'POST', body: form });
  } catch {
    throw new ApiError(0, 'UPLOAD_FAILED', 'No pudimos subir el archivo. Revisa tu conexión e intenta de nuevo.');
  }
  if (!res.ok) throw new ApiError(res.status, 'UPLOAD_FAILED', 'No pudimos subir el archivo. Verifica el tamaño y el formato.');
}

/** Descarga un archivo (CSV) que requiere sesión. */
export async function downloadFile(path: string, filename: string, opts: RequestOptions): Promise<void> {
  const res = await request<Response>(path, { ...opts, raw: true });
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
