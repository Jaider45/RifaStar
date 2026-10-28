# Rifa Star

SaaS multi-organización para crear y vender sorteos por enlace público y WhatsApp.

| Carpeta | Qué es |
| --- | --- |
| [`api/`](api/README.md) | Backend NestJS + PostgreSQL (RLS) + Redis/BullMQ. Tiene su propio README con el seed, las variables y la arquitectura. |
| `src/` | WebApp en React + Vite: panel del organizador, páginas públicas y panel de la plataforma. |
| [`docs/backend/PROPUESTA.md`](docs/backend/PROPUESTA.md) | Diseño aprobado (decisiones P1–P12). |

## Levantar todo en desarrollo

```bash
# 1. API, base de datos, Redis, almacenamiento S3 (SeaweedFS) y Mailpit (datos de ejemplo incluidos)
cd api && docker compose up -d --build

# 2. WebApp (otra terminal, desde la raíz)
npm install
npm run dev            # http://localhost:5173
```

Vite reenvía `/v1` a la API en `http://localhost:3000`, así que las cookies de sesión
funcionan sin configurar CORS. Para apuntar a otra API:

- `VITE_API_PROXY=http://otra-api:3000 npm run dev` cambia el destino del proxy en desarrollo.
- `VITE_API_URL=https://api.rifastar.co npm run build` hace que el build llame a esa URL
  directamente (agrega el origen de la WebApp a `CORS_ORIGINS` de la API).

Usuarios de ejemplo: ver [api/README.md › Usuarios del seed](api/README.md#usuarios-del-seed).
Esas claves son públicas: el seed no crea los datos de ejemplo cuando `NODE_ENV=production`.

## Demo por internet

```bash
npm run demo             # levanta Docker + túneles de Cloudflare, compila y sirve la web
npm run demo -- --stop   # apaga los túneles y la web del demo
```

Usa túneles rápidos de Cloudflare (sin cuenta): la URL `https://xxxx.trycloudflare.com` cambia
cada vez que se reinician, y el script la vuelve a poner en la API (`PUBLIC_BASE_URL`,
`S3_PUBLIC_ENDPOINT`) en `api/docker-compose.override.yml`. Tras reiniciar el equipo, los
contenedores vuelven solos; corre `npm run demo` otra vez para tener la URL nueva.
Quien tenga la URL puede entrar con las claves del seed.

## Rutas de la WebApp

| Ruta | Para quién |
| --- | --- |
| `/login`, `/registro`, `/invitacion/:token`, `/olvide` | Acceso del organizador y su equipo |
| `/admin/*` | Panel: sorteos, pagos, comprobantes de ingreso, ganadores, ranking, ventas, participantes y ajustes |
| `/plataforma/login`, `/plataforma/*` | Equipo de Rifa Star (2FA obligatorio) |
| `/{org}` | Página pública de la organización |
| `/{org}/{sorteo}` → `/pagar` → `/resultado` | Compra de números y resultados |
| `/{org}/mis-boletos`, `/{org}/ranking` | Boletos del participante (código por WhatsApp) y ranking |

El enlace de un vendedor es `/{org}?v=CODIGO` y el de un referido `/{org}?ref=CODIGO`;
los códigos se guardan durante la visita y viajan con la compra.

## Comprobaciones

```bash
npm run lint && npm test && npm run build   # WebApp: lint (sin advertencias), pruebas y build
cd api && npm run lint && npm test          # API: lint y tests (necesita Postgres y Redis)
npm audit && (cd api && npm audit)          # dependencias: 0 vulnerabilidades
```

GitHub Actions corre lo mismo en cada pull request (`.github/workflows/ci.yml`) y además
verifica que `api/openapi.json` esté al día y que ninguna dependencia tenga vulnerabilidades.

Los lockfiles se generan con npm 10 (Node 20, igual que el CI y Docker). Con npm 11 o 12
instala con `npm ci` y no regeneres el lockfile; para cambiar dependencias:
`docker run --rm -v "$PWD:/w" -w /w node:20-bookworm-slim npm install --package-lock-only`.
En la API, `deepmerge` es una copia segura en `api/vendor/deepmerge` (ver su `index.js`).
