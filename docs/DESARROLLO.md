# Guía de desarrollo

Todo lo que necesitas para trabajar en Rifa Star día a día. La presentación del proyecto está en el
[README](../README.md); la API tiene su propio [README](../api/README.md) con variables, arquitectura y
diagrama de entidades.

## Levantar todo en desarrollo

```bash
# 1. API, base de datos, Redis, almacenamiento S3 (SeaweedFS) y Mailpit (datos de ejemplo incluidos)
cd api && docker compose up -d --build

# 2. WebApp (otra terminal, desde la raíz)
npm install
npm run dev            # http://localhost:5173
```

Vite reenvía `/v1` a la API, así que las cookies de sesión funcionan sin configurar CORS. Toma el
puerto que publica la API en `api/docker-compose.override.yml` (por ejemplo `"3100:3000"`) o, si no
hay override, `http://localhost:3000`. Para apuntar a otra API:

- `VITE_API_PROXY=http://otra-api:3000 npm run dev` cambia el destino del proxy en desarrollo.
- `VITE_API_URL=https://api.rifastar.co npm run build` hace que el build llame a esa URL
  directamente (agrega el origen de la WebApp a `CORS_ORIGINS` de la API).

Usuarios de ejemplo: ver [api/README.md › Usuarios del seed](../api/README.md#usuarios-del-seed).
Esas claves son públicas: el seed no crea los datos de ejemplo cuando `NODE_ENV=production`.

## Demo por internet

```bash
npm run demo             # levanta Docker + túneles de Cloudflare, compila y sirve la web
npm run demo -- --stop   # apaga los túneles y la web del demo
```

Usa túneles rápidos de Cloudflare (sin cuenta): la URL `https://xxxx.trycloudflare.com` cambia
cada vez que se reinician, y el script la vuelve a poner en la API (`PUBLIC_BASE_URL`,
`S3_PUBLIC_ENDPOINT`) en `api/docker-compose.override.yml`. La URL vigente se le pregunta a cada túnel
(`http://<servicio>:20241/quicktunnel`) y la demo solo dice «lista» cuando la web responde por internet.
Tras reiniciar el equipo, los contenedores vuelven solos; corre `npm run demo` otra vez para tener la
URL nueva. Quien tenga la URL puede entrar con las claves del seed.

## Rutas de la WebApp

| Ruta | Para quién |
| --- | --- |
| `/login`, `/registro`, `/invitacion/:token`, `/olvide` | Acceso del organizador y su equipo |
| `/admin/*` | Panel: sorteos, pagos, comprobantes de ingreso, ganadores, ranking, ventas, participantes y ajustes |
| `/plataforma/login`, `/plataforma/*` | Equipo de Rifa Star (2FA obligatorio) |
| `/{org}` | Página pública de la organización |
| `/{org}/{sorteo}` → `/pagar` → `/resultado` | Compra de números (pago en línea o transferencia) y resultados |
| `/{org}/mis-boletos`, `/{org}/ranking` | Boletos del participante (código por WhatsApp) y ranking |

El enlace de un vendedor es `/{org}?v=CODIGO` y el de un referido `/{org}?ref=CODIGO`;
los códigos se guardan durante la visita y viajan con la compra.

## Pagos en línea (Wompi)

El participante paga con tarjeta, Nequi, PSE o Botón Bancolombia dentro de Rifa Star, y el organizador
contrata su plan con tarjeta, siempre en el checkout propio: Wompi procesa por detrás y el número de la
tarjeta nunca llega a nuestros servidores. En desarrollo funciona sin Wompi (pasarela simulada: la tarjeta
`4242 4242 4242 4242` se aprueba y la `4111 1111 1111 1111` se rechaza). Configuración y detalles en
[api/README.md › Wompi](../api/README.md#wompi-pagos-en-línea-con-checkout-propio).

## Comprobaciones

```bash
npm run lint && npm test && npm run build   # WebApp: lint (sin advertencias), pruebas y build
cd api && npm run lint && npm test          # API: lint y tests (necesita Postgres y Redis)
npm audit && (cd api && npm audit)          # dependencias: 0 vulnerabilidades
```

GitHub Actions corre lo mismo en cada pull request (`.github/workflows/ci.yml`) y además
verifica que `api/openapi.json` esté al día y que ninguna dependencia tenga vulnerabilidades.

## Dependencias

Node 24 (el que usan el CI y Docker) trae npm 11, que instala bien los lockfiles con `npm ci`. Pero
los lockfiles se **generan** con npm 10 (el de Node 22): con npm 11 o 12 no los regeneres. Para cambiar
dependencias: `docker run --rm -v "$PWD:/w" -w /w node:22-bookworm-slim npm install --package-lock-only`.
En la API, `deepmerge` es una copia segura en `api/vendor/deepmerge` (ver su `index.js`).

Dependabot agrupa los paquetes que solo se instalan juntos (React, ESLint, Vite y Vitest, pino,
NestJS, Prisma) y no propone las versiones mayores que hoy no se pueden instalar; cada exclusión
dice por qué en `.github/dependabot.yml`.

### Versiones forzadas por seguridad (`overrides`)

`package.json` y `api/package.json` fuerzan `minimatch` ≥ 11.0.3 (GHSA-g3hv-75wg-m249) y, en la API,
`glob` ≥ 14.0.3 (GHSA-3g3m-2fjr-6pw4). Son herramientas de desarrollo (ESLint, typescript-eslint y
`@nestjs/cli`), que aún no publican versiones con el arreglo; sin los `overrides` el `npm audit` del CI
falla. Se validó con lint, tipos, `nest build` y todas las pruebas. **Cuándo quitarlos:** cuando esas
herramientas pidan `minimatch` ≥ 11.0.1 por su cuenta (`npm ls minimatch` lo muestra). Único
riesgo conocido: el plugin de webpack de `@nestjs/cli` usa la API antigua de `minimatch`; el proyecto
compila con `tsc`, no con webpack, así que no se ejecuta. Si algún día se cambia a webpack, revisa esto.
