import type { RequestOptions } from '@/api/client';

type Req = <T>(path: string, opts?: RequestOptions) => Promise<T>;

/** Descarga un archivo autenticado (CSV) con la función de request del panel. */
export async function descargar(req: Req, path: string, filename: string): Promise<void> {
  const res = await req<Response>(path, { raw: true });
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
