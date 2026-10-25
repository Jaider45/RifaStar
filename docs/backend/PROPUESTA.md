# Rifa Star · Propuesta de backend (para aprobación)

> Estado: **propuesta**. No hay código del backend todavía. Este documento y
> [`schema.prisma`](./schema.prisma) son lo que pide el punto 10.1. Al final hay
> **preguntas abiertas (P1–P12)**: cada una trae una recomendación que aplicaré
> si la apruebas tal cual.

---

## 1. Stack

Mantengo el stack del documento. Lo revisé contra los requisitos y no veo una
razón de peso para cambiarlo:

| Pieza | Elección | Motivo |
|---|---|---|
| Runtime | Node 20 LTS + TypeScript `strict` | Lo pide el documento; el frontend ya es TS. |
| Framework | **NestJS 10** (adaptador Express) | Módulos, guards y decoradores encajan con `@RequirePermission` y `PlanGuard`. |
| BD | **PostgreSQL 16** + **Prisma 6** | Prisma para el CRUD; **SQL crudo** (`$queryRaw`) para el apartado atómico, la expiración y el ranking (funciones de ventana). |
| Aislamiento | `organization_id` + **RLS** | Ver §3. |
| Colas | **Redis 7 + BullMQ** | Jobs repetibles, diferidos y con reintentos. |
| Validación | **zod** + `nestjs-zod` | Un solo esquema sirve para DTOs, ajustes JSON versionados y OpenAPI. |
| Docs API | `@nestjs/swagger` → `/v1/docs` y `openapi.json` | |
| Archivos | S3 (MinIO en desarrollo), URLs firmadas | |
| Auth | JWT de acceso (15 min) + refresh rotativo en cookie `httpOnly` | `argon2id` para contraseñas, `otplib` para TOTP. |
| Logs | `pino` (`nestjs-pino`) con redacción | Teléfonos → `***7781`, sin cuerpos de comprobantes ni tokens. |
| Tests | **Vitest** + Supertest contra Postgres y Redis reales | La prueba de concurrencia necesita Postgres de verdad. |
| Dev | Docker Compose: `api`, `worker`, `postgres`, `redis`, `minio`, `mailpit` | |

**Estructura del repositorio:** el backend va en `api/`, separado del frontend
actual (que no toco). Un solo código con dos procesos: `api` (HTTP) y `worker`
(BullMQ).

```
api/
  prisma/ schema.prisma, migrations/ (incluye SQL de RLS, CHECKs y triggers), seed.ts
  src/
    common/      errores, filtros, zod, logger, rate-limit, phone (E.164), money
    tenancy/     contexto de request, TenantPrisma (RLS), resolución de org
    auth/        org users, platform users, 2FA, refresh tokens
    permissions/ catálogo, @RequirePermission, PermissionGuard
    plans/       PlanGuard, límites y flags
    audit/
    organizations/ members/ roles/ settings/ payment-accounts/
    raffles/ numbers/ orders/ tickets/ receipts/
    results/     winner-rules.ts (módulo puro) + servicio
    ranking/
    messaging/   MessagingProvider (Meta Cloud API, fake)
    billing/     BillingProvider (Stripe; interfaz lista para Wompi / Mercado Pago)
    platform/    orgs, planes, roles, equipo, facturación, auditoría, soporte
    public/      endpoints sin sesión
    jobs/        definiciones y procesadores BullMQ
  test/
```

---

## 2. Decisiones de diseño clave

### 2.1 Apartado atómico (regla 1)

Dentro de una transacción `READ COMMITTED`:

```sql
UPDATE raffle_numbers
   SET status = 'reserved', order_id = $order, reserved_until = $until, updated_at = now()
 WHERE raffle_id = $raffle AND number = ANY($numbers) AND status = 'available'
RETURNING number;
```

- Si `RETURNING` trae menos de N filas → `ROLLBACK` y `409 NUMBERS_TAKEN` con
  `details.taken = numeros_pedidos − devueltos`.
- Dos transacciones que compiten por la misma fila se serializan por el bloqueo
  de fila; la segunda vuelve a evaluar `status = 'available'` y no actualiza nada.
- `random: N` → `SELECT … WHERE status='available' ORDER BY random() LIMIT N FOR UPDATE SKIP LOCKED` y luego el mismo `UPDATE`.
- En la misma transacción: se valida que el sorteo esté `active` y antes de
  `sales_close_at`, el mínimo por compra, se hace upsert del `Participant`, se crea la `Order` y se actualiza `held_count`.
- Idempotencia del POST con la cabecera `Idempotency-Key` (`orders.idempotency_key`).

### 2.2 Vencimiento (regla 2)

El job `expire-reservations` (cada minuto) procesa lotes con
`FOR UPDATE SKIP LOCKED` de órdenes `reserved` con `reserved_until < now()` y
sin comprobante: la orden pasa a `expired` y sus números a `available`. Subir el
comprobante hace `UPDATE orders SET status='pending_verification' WHERE status='reserved'`:
la carrera con el job la gana quien hace commit primero, y nunca quedan las dos.

### 2.3 Aprobación (regla 3)

Una transacción: orden → `approved`; números → `paid` (verificando que siguen
siendo de la orden); tickets `RS-{secuencia:4}-{número:N cifras}`;
`paid_count`; `PointsEvent` (`order:{id}:paid`) si el ranking está activo y el
plan lo permite; bono de constancia si aplica; `sold_out` si
`paid_count = total_numbers`; `AuditLog`. **Después del commit** se encola
`send-whatsapp` con `idempotencyKey = ticket:{orderId}`.

### 2.4 Multi-tenant y RLS (§8)

- El rol de BD de la aplicación (`rifastar_app`) **no** tiene `BYPASSRLS`.
- Cada operación del tenant corre en `tenantTx(orgId, fn)`, que hace
  `SELECT set_config('app.org_id', $orgId, true)` al iniciar la transacción.
- Política en cada tabla del tenant:
  `USING (organization_id = current_setting('app.org_id', true)::uuid)` y el mismo `WITH CHECK`.
- Además, los servicios filtran por `organizationId` de forma explícita (primera barrera).
- Un segundo cliente con rol `rifastar_system` (`BYPASSRLS`) se usa **solo** en
  el módulo de plataforma, al resolver la org por slug o dominio, y en los
  despachadores de jobs. Una regla de lint impide importarlo desde otros módulos.
- La org activa se resuelve así: cabecera `X-Organization-Id` (panel) →
  dominio propio (`Host`) → slug en la ruta pública.

### 2.5 Permisos (§5)

- `@RequirePermission('payments.approve')` + `PermissionGuard`: resuelve
  `Member` (org activa + usuario) → `Role` → claves. Se cachea 60 s en Redis y
  se invalida al cambiar un rol o una membresía.
- Los roles base son filas globales (`organization_id = null`). Un cambio en la
  plantilla de plataforma aplica a todas las orgs (ver **P10**). `owner` está
  bloqueado y siempre tiene todas las claves.
- Último owner: no se puede quitar ni cambiar de rol (`409 LAST_OWNER`).
- Plataforma: `@RequirePlatformPermission('platform.orgs.read')` con un token de
  audiencia distinta (`aud=platform`) que solo se emite tras pasar TOTP.

### 2.6 Entrar como soporte (regla 9)

- `POST /v1/platform/orgs/:id/support-sessions {reason, minutes ≤ 60}` crea
  `SupportSession` + `AuditLog` y devuelve un **access token de soporte**
  (`typ=support`, `ro=true`, `org`, `sid`), sin refresh.
- Con ese token, el guard solo permite `GET`/`HEAD`. Cualquier otro método
  responde `403 SUPPORT_READ_ONLY`. Cada request queda registrada en
  `AuditLog` (`support.request`).
- Cabeceras:
  - en las respuestas al agente de soporte: `X-Support-Session: id=…; expires=…`;
  - en **todas las respuestas al organizador** mientras haya una sesión activa en su org:
    `X-Support-Active: expires=2026-10-25T15:30:00Z` → el frontend muestra el aviso.

### 2.7 Ajustes (`OrgSettings`), esquemas zod v1

| Sección | Campos | Permiso para escribir |
|---|---|---|
| `payments` | `reservationMinutes: 30\|60\|120` (30), `requireReceipt: bool` (true) | `settings.brand` |
| `ranking` | `enabled`, `pointsPerNumber` (1), `consistencyBonus {enabled, minRaffles, points}`, `referralBonus {enabled, points}`, `frequency: monthly\|biweekly\|weekly`, `weeklyResetDay` (1 = lunes), `tiebreaker: first_to_reach\|most_raffles`, `publicTopSize: 10\|20\|50`, `nameFormat: first_name_initial\|initials\|nickname`, `prizes: string[]`, `announceOnClose: bool` | `ranking.configure` |
| `notifications` | `purchaseConfirmation`, `drawReminder`, `newRaffleNotice`, `dailyDigest` (bool) | `settings.brand` |
| `branding` | `hideRifaStarBadge` (requiere `whiteLabel`) | `settings.brand` |

El nombre, el logo, el color por defecto, la zona horaria, el WhatsApp de
soporte y el dominio propio viven en `Organization` (columnas propias, no en JSON).

### 2.8 Ranking

- Puntos = `SUM(points)` de `points_events` del periodo. Nunca se guardan totales editables.
- Desempate `first_to_reach`: momento en que la suma acumulada (ventana por
  `created_at, id`) alcanzó por primera vez el total final. `most_raffles`:
  `COUNT(DISTINCT raffle_id)` de eventos `number_paid` con saldo neto positivo. Desempate final: `participant_id` (estable).
- Límites del periodo calculados con la zona horaria de la org (`Temporal` /
  `date-fns-tz`) y guardados en UTC. Un evento cae en el periodo abierto según
  la fecha de **aprobación**.
- `ranking-rollover` es idempotente: cierra el periodo `open` vencido, congela
  `snapshot` y `config_snapshot`, abre el siguiente (índice único parcial «uno
  abierto por org»), registra `JobRun` y encola el top 10 si `announceOnClose`.

### 2.9 Privacidad pública (regla 7)

`displayName(participant, nameFormat)` → «Laura M.» / «L. M.» / apodo (si no
hay apodo: «Laura M.»). `maskPhone` → `***7781`. Los endpoints públicos nunca
seleccionan la columna `phone` completa: usan un DTO de proyección.

### 2.10 Comprobantes (§8)

1. `POST /public/orders/:id/receipt` → URL firmada **POST** de S3 con
   `content-length-range` 1 B – 10 MB, `Content-Type` en la lista
   (`image/jpeg|png|webp|heic`, `application/pdf`) y una key
   `receipts/{org}/{order}/{uuid}` que vence en 5 min.
2. `POST /public/orders/:id/receipt/confirm {key}` → el servidor lee los
   primeros bytes del objeto y valida los **magic bytes** (`file-type`). Si no
   coinciden, borra el objeto y responde `422 RECEIPT_INVALID_TYPE`. Si
   coinciden, la orden pasa a `pending_verification`.
3. Lectura en el panel: URL firmada GET de **60 s**.

### 2.11 Formato de error único

```json
{ "code": "NUMBERS_TAKEN", "message": "Los números 07 y 23 ya fueron apartados por otra persona. Elige otros.", "details": { "taken": [7, 23] } }
```

Catálogo inicial: `VALIDATION_ERROR` (400), `AUTH_REQUIRED` (401),
`AUTH_INVALID_CREDENTIALS` (401), `AUTH_2FA_REQUIRED` (401),
`AUTH_2FA_INVALID` (401), `FORBIDDEN_PERMISSION` (403), `SUPPORT_READ_ONLY` (403),
`ORG_SUSPENDED` (403), `NOT_FOUND` (404), `NUMBERS_TAKEN` (409),
`ORDER_INVALID_STATE` (409), `ORDER_EXPIRED` (409), `LAST_OWNER` (409),
`REVISION_CONFLICT` (409), `RAFFLE_NOT_ON_SALE` (409), `RECEIPT_INVALID_TYPE` (422),
`RECEIPT_TOO_LARGE` (422), `OTP_INVALID` (401), `OTP_LOCKED` (429),
`RATE_LIMITED` (429), `PLAN_LIMIT_ACTIVE_RAFFLES` (402), `PLAN_LIMIT_MEMBERS` (402),
`PLAN_QUOTA_WHATSAPP` (402), `PLAN_FEATURE_RANKING` (402),
`PLAN_FEATURE_SELLERS` (402), `PLAN_FEATURE_CUSTOM_ROLES` (402),
`PLAN_FEATURE_CUSTOM_DOMAIN` (402), `PLAN_FEATURE_WHITE_LABEL` (402),
`PLAN_FEATURE_WHATSAPP_AUTOMATION` (402), `INTERNAL` (500).

---

## 3. Endpoints

Prefijo `/v1`. «Org» = requiere sesión de usuario de org + cabecera
`X-Organization-Id`. Entre corchetes, la verificación de `PlanGuard`.

### 3.1 Autenticación de usuarios de organización

| Método | Ruta | Permiso | Cuerpo |
|---|---|---|---|
| POST | `/auth/signup` *(ver P1)* | — | `{ name, email, password, organization: { name, slug } }` |
| POST | `/auth/login` | — | `{ email, password, totpCode? }` |
| POST | `/auth/refresh` | cookie `rs_rt` | — |
| POST | `/auth/logout` | sesión | — |
| GET | `/auth/me` | sesión | → usuario + membresías + permisos por org |
| POST | `/auth/2fa/setup` · `/auth/2fa/enable` · `/auth/2fa/disable` | sesión | `{ code }` |
| POST | `/auth/password/forgot` · `/auth/password/reset` *(ver P2)* | — | `{ email }` · `{ token, password }` |
| GET | `/invitations/:token` | — | → org, rol, email |
| POST | `/invitations/:token/accept` | — | `{ name, password }` (o vincula una cuenta existente si hay sesión) |

### 3.2 Pública (sin sesión · rate limit · caché corta)

| Método | Ruta | Cuerpo / query | Notas |
|---|---|---|---|
| GET | `/public/orgs/:orgSlug/raffles/:raffleSlug` | — | Sorteo, premios, avance (`paid`, `held`, `total`), cuentas de pago, `drawAt`, `salesCloseAt`, `serverTime`, marca. `Cache-Control: max-age=15` |
| GET | `/public/orgs/:orgSlug/raffles/:raffleSlug/numbers` | `?status=available\|unavailable\|all` | `{ total, encoding: "bitset-2b", data: base64 }`: 2 bits por número (disponible / apartado / en verificación / pagado). Son 2,5 KB para 10.000. `ETag` + `max-age=3` |
| POST | `/public/orgs/:orgSlug/raffles/:raffleSlug/orders` | `{ name, phone, numbers?: int[], random?: int, sellerCode?, nickname? }` + `Idempotency-Key` | → `{ orderId, accessToken, numbers, totalCop, reservedUntil, paymentAccounts }`. Rate limit por IP y por teléfono |
| GET | `/public/orders/:id` | `X-Order-Token` | Estado y cuenta regresiva de la pantalla de pago |
| POST | `/public/orders/:id/receipt` | `{ contentType, size }` + `X-Order-Token` | → `{ url, fields, key, expiresAt }` (POST firmado) |
| POST | `/public/orders/:id/receipt/confirm` | `{ key }` + `X-Order-Token` | Valida los magic bytes → `pending_verification` |
| POST | `/public/orgs/:orgSlug/my-tickets/otp` | `{ phone }` | Siempre `202` (no revela si el teléfono existe). 1 cada 60 s y 5 por hora por teléfono |
| POST | `/public/orgs/:orgSlug/my-tickets/verify` | `{ phone, code }` | → `{ token }` (JWT de participante, 30 min). 5 intentos por desafío |
| GET | `/public/orgs/:orgSlug/my-tickets` | `Authorization: Bearer <token participante>` | Boletos, órdenes, resultados, puesto en el ranking |
| GET | `/public/orgs/:orgSlug/ranking` | `?period=current\|YYYY-MM\|YYYY-MM-DD` | Top N (según `publicTopSize`), cuenta regresiva y premios. Nombres formateados y teléfonos `***7781` |
| GET | `/public/orgs/:orgSlug/raffles/:raffleSlug/results` | — | Solo si `results_published_at`; ganadores con nombre formateado o «No vendido» |
| POST | `/public/orgs/:orgSlug/notify-me` | `{ name, phone }` | Upsert del participante + suscripción |

### 3.3 Webhooks

| Método | Ruta | Verificación |
|---|---|---|
| GET | `/webhooks/whatsapp` | `hub.verify_token` (alta de Meta) |
| POST | `/webhooks/whatsapp` | `X-Hub-Signature-256` (HMAC con el app secret) → estados en `MessageLog` |
| POST | `/webhooks/billing/stripe` | `Stripe-Signature` → `BillingEvent` (bandeja) → job `billing-sync` |

### 3.4 Organización (sesión + `X-Organization-Id`)

**Sorteos**

| Método | Ruta | Permiso | Cuerpo |
|---|---|---|---|
| GET | `/raffles` | `raffles.view` | `?status=&q=&cursor=` |
| POST | `/raffles` | `raffles.edit` | `{ title, slug?, lottery, drawAt, salesCloseAt?, pricePerNumber, digits, minPerOrder, accentColor?, conditionText?, authorizationNumber?, prizes[], paymentAccountIds? }` → `draft` |
| GET | `/raffles/:id` | `raffles.view` | — |
| PATCH | `/raffles/:id` | `raffles.edit` | Igual que al crear (parcial). Tras publicar no cambian `digits` ni `pricePerNumber` |
| PUT | `/raffles/:id/prizes` | `raffles.edit` | `{ prizes: [{ position, amountCop?, description?, rule, customRuleText?, anticipatedLottery?, anticipatedDrawAt? }] }` |
| POST | `/raffles/:id/cover` · `/raffles/:id/cover/confirm` | `raffles.edit` | `{ contentType, size }` · `{ key }` |
| POST | `/raffles/:id/publish` | `raffles.publish` [`maxActiveRaffles`] | — Crea las filas de números y programa `close-sales` y `draw-reminder` |
| POST | `/raffles/:id/close-sales` | `raffles.publish` | — |
| POST | `/raffles/:id/duplicate` | `raffles.edit` | `{ title?, drawAt? }` → nuevo `draft` |
| POST | `/raffles/:id/cancel` | `raffles.publish` *(ver P11)* | `{ reason }` |
| DELETE | `/raffles/:id` | `raffles.delete` | Solo `draft` (borrado lógico) |
| GET | `/raffles/:id/numbers` | `raffles.view` | Grilla con referencia a la orden (contacto solo con `participants.view_contact`) |

**Pagos (órdenes)**

| Método | Ruta | Permiso | Cuerpo |
|---|---|---|---|
| GET | `/payments/queue` | `payments.view` | `?raffleId=` → `pending_verification`, más antiguos primero (`receipt_uploaded_at ASC`) |
| GET | `/orders` | `payments.view` | `?raffleId=&status=&q=&sellerMemberId=&cursor=` |
| GET | `/orders/:id` | `payments.view` | Incluye `receiptUrl` firmada (60 s). El teléfono va enmascarado salvo con `participants.view_contact` |
| POST | `/orders/:id/approve` | `payments.approve` | `{}` |
| POST | `/orders/:id/reject` | `payments.approve` | `{ reason }` → libera los números y notifica |
| POST | `/orders/:id/release` | `payments.release` | `{ reason }` (ver P9) |
| GET | `/sales/mine` | `sales.view_own` [`sellers`] | `?raffleId=&from=&to=` → órdenes con mi código + totales |

**Participantes**

| Método | Ruta | Permiso | Cuerpo |
|---|---|---|---|
| GET | `/participants` | `participants.view_contact` | `?q=&raffleId=&cursor=` |
| GET | `/participants/:id` | `participants.view_contact` | Órdenes, boletos y puntos |
| GET | `/participants/export.csv` | `participants.export` | `?raffleId=` (queda en `AuditLog`) |

**Resultados y ganadores**

| Método | Ruta | Permiso | Cuerpo |
|---|---|---|---|
| PUT | `/raffles/:id/result` | `winners.announce` | `{ mainResult: "4087", anticipatedResult?: "1213", customWinners?: [{ prizeId, number }] }` → calcula los ganadores |
| POST | `/raffles/:id/result/evidence` · `…/evidence/confirm` | `winners.announce` | `{ contentType, size }` · `{ key }` (imagen o video) |
| POST | `/raffles/:id/winners/recalculate` | `winners.announce` | — |
| GET | `/raffles/:id/winners` | `raffles.view` | — |
| POST | `/winners/:id/deliver` | `winners.announce` | `{ note? }` |
| POST | `/raffles/:id/results/publish` | `winners.announce` | — → sorteo `drawn`, visible en público |
| POST | `/raffles/:id/results/notify` | `winners.announce` [`whatsappAutomation`, cuota] | — WhatsApp a los ganadores |

**Ranking** [`ranking`]

| Método | Ruta | Permiso | Cuerpo |
|---|---|---|---|
| GET | `/ranking/current` | `raffles.view` | Tabla con puntos, sorteos, invertido y cambio de puesto |
| GET | `/ranking/periods` | `raffles.view` | Historial |
| GET | `/ranking/periods/:id` | `raffles.view` | Snapshot (cerrado) o cálculo en vivo (abierto) |
| POST | `/ranking/adjustments` | `ranking.configure` | `{ participantId, points, reason }` → `PointsEvent` + `AuditLog` |
| GET | `/ranking/periods/:id/export.csv` | `ranking.configure` | Teléfono completo solo con `participants.view_contact` |
| POST | `/ranking/periods/:id/announce` | `ranking.configure` [`whatsappAutomation`, cuota] | — top 10 por WhatsApp |

**Ajustes, equipo y plan**

| Método | Ruta | Permiso | Cuerpo |
|---|---|---|---|
| GET | `/organization` | miembro | — |
| PATCH | `/organization` | `settings.brand` | `{ name?, supportWhatsapp?, defaultAccentColor?, timezone? }` |
| POST | `/organization/logo` · `/organization/logo/confirm` | `settings.brand` | — |
| PUT | `/organization/custom-domain` | `settings.brand` [`customDomain`] | `{ domain }` |
| GET | `/settings` | miembro | Todas las secciones |
| PUT | `/settings/:section` | `settings.brand` (`ranking.configure` para `ranking`) | `{ revision, data }` [`ranking` → flag; `branding.hideRifaStarBadge` → `whiteLabel`] |
| GET / POST | `/payment-accounts` | `payments.view` / `settings.brand` | `{ type, keyOrNumber, holderName, bankName?, accountKind? }` |
| PATCH / DELETE | `/payment-accounts/:id` | `settings.brand` | — |
| GET | `/team` | `settings.team` | Miembros + invitaciones |
| POST | `/team/invitations` | `settings.team` [`maxMembers`; rol `seller` → `sellers`] | `{ email, name, roleId, sellerCode? }` |
| PATCH | `/team/members/:id` | `settings.team` | `{ roleId?, sellerCode? }` (protege al último owner) |
| DELETE | `/team/members/:id` | `settings.team` | — |
| POST | `/team/members/:id/resend-invitation` | `settings.team` | — |
| GET | `/roles` | `settings.team` | Base + personalizados, con sus claves |
| POST / PATCH / DELETE | `/roles(/:id)` | `settings.team` [`customRoles`] | `{ name, permissions: string[] }` |
| GET | `/permissions` | miembro | Catálogo de claves |
| GET | `/billing` | `settings.billing` | Plan, estado, renovación y uso (sorteos, miembros, mensajes) |
| POST | `/billing/checkout` | `settings.billing` | `{ planCode }` → URL del proveedor |
| POST | `/billing/portal` | `settings.billing` | → URL del portal del proveedor |
| GET | `/billing/invoices` | `settings.billing` | — |

**Dashboard**

| Método | Ruta | Permiso | Respuesta |
|---|---|---|---|
| GET | `/dashboard` | `raffles.view` | Recaudo de la semana (solo con `payments.view`), pagos por verificar, sorteos activos, próximo sorteo |

### 3.5 Plataforma (`/v1/platform`, usuarios de plataforma con TOTP)

| Método | Ruta | Permiso | Cuerpo |
|---|---|---|---|
| POST | `/platform/auth/login` | — | `{ email, password }` → `{ challengeToken, needsEnrollment }` |
| POST | `/platform/auth/2fa/enroll` | challenge | → `{ otpauthUrl }` (primer ingreso) |
| POST | `/platform/auth/2fa/verify` | challenge | `{ challengeToken, code }` → access + cookie `rs_prt` |
| POST | `/platform/auth/refresh` · `/platform/auth/logout` | cookie | — |
| GET | `/platform/me` | sesión | — |
| GET | `/platform/stats` | `platform.orgs.read` (MRR con `platform.billing.read`) | Orgs activas, en prueba, pago fallido, MRR |
| GET | `/platform/orgs` | `platform.orgs.read` | `?status=active\|trial\|past_due\|suspended&q=&cursor=` |
| GET | `/platform/orgs/:id` | `platform.orgs.read` | Plan, uso, miembros, último acceso |
| POST | `/platform/orgs` | `platform.orgs.write` | `{ name, slug, ownerEmail, ownerName, planCode?, trial: bool }` |
| PATCH | `/platform/orgs/:id` | `platform.orgs.write` | `{ name?, slug?, timezone? }` |
| POST | `/platform/orgs/:id/suspend` | `platform.orgs.write` | `{ reason }` |
| POST | `/platform/orgs/:id/reactivate` | `platform.orgs.write` | — |
| POST | `/platform/orgs/:id/support-sessions` | `platform.impersonate` | `{ reason, minutes }` → token de soporte |
| DELETE | `/platform/support-sessions/:id` | `platform.impersonate` | — |
| GET | `/platform/plans` | `platform.orgs.read` | — |
| POST / PATCH | `/platform/plans(/:id)` | `platform.plans.write` | Precio, límites, flags, `externalPriceIds` |
| DELETE | `/platform/plans/:id` | `platform.plans.write` | Archiva (solo sin suscripciones activas) |
| GET / PUT | `/platform/trial-config` | `platform.plans.write` | `{ planCode, days, onExpire, downgradePlanCode?, pastDueGraceDays }` |
| GET | `/platform/role-templates` | `platform.roles.write` | Matriz de roles base × claves |
| PUT | `/platform/role-templates/:roleKey/permissions` | `platform.roles.write` | `{ permissions: string[] }` (`owner` bloqueado) |
| GET / POST | `/platform/team` | `platform.roles.write` | `{ email, name, role }` |
| PATCH / DELETE | `/platform/team/:id` | `platform.roles.write` | `{ role }` (no se puede quitar el último `super_admin`) |
| PUT | `/platform/role-permissions/:platformRole` | `platform.roles.write` | `{ permissions }` (`super_admin` bloqueado) |
| GET | `/platform/billing/subscriptions` | `platform.billing.read` | `?status=` |
| GET | `/platform/billing/failed-payments` | `platform.billing.read` | Facturas `failed` |
| PUT | `/platform/orgs/:id/subscription` | `platform.billing.write` | `{ planCode, provider: "manual", periodEnd? }` (cambio manual) |
| GET | `/platform/billing/events` | `platform.billing.read` | Webhooks recibidos y su estado |
| POST | `/platform/billing/events/:id/retry` | `platform.billing.write` | — |
| GET | `/platform/audit-logs` | `platform.orgs.read` | `?organizationId=&actorType=&actorId=&action=&entityType=&from=&to=&cursor=` |

Matriz inicial de plataforma: `super_admin` = todo; `support` = `platform.orgs.read`
y `platform.impersonate`; `finance` = `platform.orgs.read`,
`platform.billing.read` y `platform.billing.write` (coincide con las
descripciones de la pantalla de roles).

---

## 4. Procesos en segundo plano (BullMQ)

| Cola / job | Disparo | Idempotencia |
|---|---|---|
| `expire-reservations` | Repetible, cada minuto | `UPDATE … WHERE status='reserved' AND reserved_until < now() AND receipt_key IS NULL`. Repetirlo no cambia nada |
| `close-sales` | Diferido a `sales_close_at` (jobId `close:{raffle}:{epoch}`) + barrido cada minuto | `UPDATE raffles SET status='closed' WHERE status IN ('active','sold_out') AND sales_close_at <= now()` |
| `draw-reminder` | Diferido a `draw_at − 2 h` | `MessageLog.idempotency_key = reminder:{raffle}:{participant}` |
| `ranking-rollover` | Repetible cada 15 min; evalúa por org si `now() ≥ ends_at` del periodo abierto | Índice único «un periodo abierto» + `JobRun(rollover, org:period)` |
| `send-whatsapp` | Encolado por eventos | `MessageLog.idempotency_key` único; reserva de cuota atómica en `UsageCounter`; 5 reintentos exponenciales (30 s → 8 min); los errores 4xx permanentes no se reintentan |
| `daily-digest` | Repetible cada 15 min; envía a las 20:00 locales de cada org con el ajuste activo | `JobRun(digest, org:YYYY-MM-DD)` |
| `billing-sync` | Por cada `BillingEvent` + barrido diario | `BillingEvent.processed_at`; transiciones `active→past_due→suspended` según `pastDueGraceDays` |
| `trial-expiry` | Diario (forma parte de `billing-sync`) | Aplica `TrialConfig.onExpire` una sola vez (`JobRun`) |

Al cambiar `sales_close_at` o `draw_at`, se reprograman los jobs diferidos (el
jobId incluye la fecha, así que los viejos quedan como no-op).

---

## 5. Plan por fases

Cada fase se entrega con `lint`, `typecheck` y tests en verde, en commits sobre
`claude/intelligent-fermi-x85lvu`.

**Fase 1 · Base**
- Proyecto Nest, config validada con zod, Docker Compose, `pino`, filtro de errores `{code, message, details}`, OpenAPI.
- Prisma: esquema completo + migraciones SQL (RLS, CHECKs, índices parciales, triggers de inmutabilidad, roles de BD).
- `TenantPrisma`/`tenantTx`, resolución de org, contexto de request.
- Auth de org (login, refresh rotativo con detección de reutilización, logout, 2FA opcional) y de plataforma (TOTP obligatorio).
- Organizaciones, membresías, invitaciones, roles y permisos, `@RequirePermission`, último owner, `AuditLog`.
- Seed base: permisos, roles plantilla, planes y `super_admin`.
- **Tests:** permisos por rol (matriz completa de la plantilla × endpoints representativos), aislamiento entre orgs (API + RLS directo: con `app.org_id` de A no se ve nada de B), rotación y reutilización del refresh token, TOTP de plataforma, último owner.

**Fase 2 · Sorteos, números, apartado y pagos**
- CRUD de sorteos, premios, portada, publicar (crea números), cerrar, duplicar, cancelar, borrar borrador.
- Endpoints públicos del sorteo y de la grilla (bitset), apartado atómico, `random: N`, código de vendedor.
- Comprobante (POST firmado + magic bytes), cola de pagos, aprobar, rechazar, liberar, tickets, `sold_out`.
- Jobs `expire-reservations` y `close-sales`. Rate limiting (Redis) por IP y por teléfono.
- Participantes: lista, detalle, CSV. Dashboard. Cuentas de pago.
- **Tests:** **50 solicitudes simultáneas por el mismo número → 1 éxito y 49 `NUMBERS_TAKEN`**, órdenes con varios números que se cruzan, carrera entre expiración y comprobante, validación de comprobantes (PNG renombrado a `.pdf`, ejecutable con extensión `.jpg`, más de 10 MB), aprobación (tickets y `sold_out`), cierre automático.

**Fase 3 · Resultados y ganadores**
- `winner-rules.ts` puro: `(rule, digits, mainResult, anticipatedResult) → number[]`.
- Registrar y corregir el resultado (con revisión y auditoría), evidencia, recalcular, «No vendido», entregar, publicar, avisar.
- Endpoint público de resultados.
- **Tests:** cada regla para 2, 3 y 4 cifras, con ceros a la izquierda («0007»), número no vendido y número apartado sin pagar (no gana).

**Fase 4 · Ranking**
- Libro `PointsEvent` (puntos por aprobación, reversión en liberación, bonos, ajustes manuales con auditoría), periodos, cálculo con desempate, rollover por zona horaria, snapshot, historial, CSV y ranking público con privacidad.
- **Tests:** rollover en el cambio de mes con `America/Bogota` (31 oct 23:59:59 local vs. 1 nov 00:00 local = 05:00 UTC) y con otra zona (`Europe/Madrid`, con cambio de horario), quincenal y semanal, los dos desempates, inmutabilidad del libro (UPDATE y DELETE fallan), formato de nombre y máscara de teléfono.

**Fase 5 · WhatsApp y colas**
- `MessagingProvider` + `MetaCloudWhatsAppProvider` + `FakeMessagingProvider`; plantillas; `send-whatsapp` con cuota y reintentos; webhook de estados con firma.
- Confirmación de boleto, rechazo, OTP de «Mis boletos» (+ endpoints), `draw-reminder`, top 10, «Avísame», `daily-digest`.
- **Tests:** idempotencia (encolar dos veces → un envío), reintentos, cuota agotada (ver P6), firma inválida → 401, flujo OTP (vencimiento, intentos, no revela existencia).

**Fase 6 · Plataforma, planes y facturación**
- `PlanGuard` central (decorador `@RequirePlan({ feature })` / `@CheckLimit('activeRaffles')` + servicio `PlanPolicy` para los chequeos dentro de servicios y jobs).
- CRUD de planes, configuración de la prueba, plantilla de roles, equipo de plataforma.
- Orgs de plataforma (lista con filtros, crear, suspender, reactivar), entrar como soporte (+ cabeceras), registro de actividad.
- `BillingProvider` + `StripeBillingProvider` (checkout, portal, webhooks) + `billing-sync` + expiración de la prueba.
- **Tests:** cada límite y cada flag → `402` con su código, soporte en solo lectura (POST → 403, cabecera presente para el organizador, auditoría), webhook de Stripe firmado e idempotente, transiciones `past_due` → `suspended`.

**Cierre:** seed completo (§9), `README` con Docker, variables de entorno, diagrama ER (Mermaid) y colección OpenAPI exportada.

---

## 6. Seed (§9)

- Plataforma: `super_admin` (`admin@rifastar.co`, TOTP con un secreto fijo de dev impreso en consola), planes Básico, Pro y Agencia con los límites de la pantalla (2/1/300, 10/5/2.000, ∞/20/10.000) y `TrialConfig` (Pro, 14 días, «Pasar a Básico»; los días los ajustas tú).
- **Rifas de Michellys** (`michellys`, Pro, `active`): Michellys Tovar (owner), José Rodríguez (admin), Karen Díaz (verificadora), Luis Mora (vendedor, código `LUIS`). Llave Bre-B `3168110777` a nombre de José Rodríguez.
- Sorteo «Gana con Boyacá · Sorteo semanal»: 2 cifras, $6.000, Lotería de Boyacá, 10:40 p. m., cierre 3:30 p. m., con los 5 premios. **62 números pagados** (los mismos del mock), **7 órdenes en verificación** (las 7 personas del mock; como en el mock los números 05, 40 y 41 aparecen a la vez como pagados y como pendientes, en el seed esas órdenes usan números libres: 04; 06, 07, 76 — el resto queda igual: 24; 48, 49; 73; 16, 19; 62).
- Ranking de octubre con ~20 participantes, a partir de `PointsEvent` de órdenes aprobadas en sorteos anteriores (17 oct y 10 oct, ya `drawn`).
- Segunda org **«Moto Ya»** (`motoya`, en prueba) con su owner, un sorteo y participantes propios (incluido un teléfono repetido con Michellys para probar que `Participant` es por org).

---

## 7. Preguntas abiertas

Cada una trae mi **recomendación**. Si apruebas sin comentarios, aplico la recomendación.

**P1. Alta de organizaciones.** El documento no dice si una org se registra sola
o solo la crea la plataforma. La pantalla de planes habla de «plan con el que
empieza una organización nueva».
→ *Recomiendo:* registro autoservicio `POST /auth/signup` que crea el usuario
owner y la org en `trial`, y además `POST /platform/orgs` para la plataforma.

**P2. Correo electrónico.** Las invitaciones de equipo y la recuperación de
contraseña necesitan un canal, y el documento no menciona un proveedor de correo.
→ *Recomiendo:* interfaz `MailProvider` con implementación SMTP (Mailpit en
desarrollo; en producción, cualquier SMTP como SES o Resend). Alternativa: que
la invitación devuelva un enlace para copiar y enviar por WhatsApp a mano.
Login de usuarios de org: email + contraseña, con 2FA TOTP **opcional**.

**P3. Reglas de premio en 3 y 4 cifras.** Con un resultado `ABCD`:
→ *Recomiendo:*
- **3 cifras:** `last_three` = BCD, `first_three` = ABC, `anticipated_full_number` = las 3 últimas del anticipado.
- **4 cifras:** `full_number` = ABCD, `anticipated_full_number` = el resultado completo del anticipado.
- Las reglas de 2 cifras (`last_two`, `first_two`, `middle_two`, `digits_1_and_4`, `anticipated_last_two`) en un sorteo de 3 o 4 cifras: **no permitidas** (validación al crear).

¿O se usan como aproximaciones (por ejemplo, en 4 cifras, todos los números pagados que terminan en CD ganan `last_two`)? El módulo soporta ambas; necesito saber cuál habilitar.

**P4. Pagos en verificación al cierre de venta.** Al llegar a `sales_close_at`:
→ *Recomiendo:* las órdenes `reserved` sin comprobante vencen de inmediato; las
`pending_verification` con comprobante subido **antes** del cierre se pueden
seguir aprobando hasta el sorteo; ya no se aceptan comprobantes nuevos.

**P5. Bono por referir.** No hay un mecanismo de referido definido.
→ *Recomiendo:* cada participante tiene un `referralCode` (visible en «Mis
boletos»); el enlace `?ref=CODIGO` se guarda en la primera orden del nuevo
participante, y el bono se otorga **una vez** cuando se aprueba la primera
compra del referido. Alternativa: posponer el bono por referido.

**P6. Cuota de WhatsApp agotada.**
→ *Recomiendo:* los mensajes **transaccionales** (OTP, boleto, rechazo) se
envían siempre, cuentan contra la cuota y pueden pasarse del límite (queda
visible en «uso»); los **promocionales o automáticos** (recordatorio, top 10,
«Avísame», resumen diario) se omiten con `skipped_quota`. Las acciones
manuales de «avisar» responden `402 PLAN_QUOTA_WHATSAPP`. Así nadie se queda sin su boleto ni sin su código.

**P7. Política de cobro fallido.**
→ *Recomiendo:* pago fallido → `past_due` (todo sigue funcionando y se
muestra un aviso); a los **7 días** (configurable en `TrialConfig.pastDueGraceDays`)
→ `suspended`: el panel queda en solo lectura, los enlaces públicos muestran
«Sorteo no disponible» y no se pueden apartar números. Las órdenes ya
pagadas y los resultados se conservan. Al pagar → `active`.

**P8. Periodos quincenal y semanal.**
→ *Recomiendo:* quincenal = del 1 al 15 y del 16 a fin de mes; semanal = desde
el día configurado (lunes por defecto) a las 00:00 locales. La URL pública
acepta `YYYY-MM` (mensual) y `YYYY-MM-DD` (fecha de inicio para los otros).

**P9. Liberar una orden ya aprobada** (`payments.release`, «Liberar números y reembolsar»).
→ *Recomiendo:* se permite con motivo; los números vuelven a `available`, los
tickets quedan `void`, se registra un `PointsEvent` **negativo** que revierte
los puntos (el libro no se edita) y queda en `AuditLog`. El reembolso del
dinero ocurre fuera de la plataforma. Agregué el estado `released` a `Order`
para distinguirlo de `rejected`. No se permite después de que se registra el resultado.

**P10. Plantilla de roles base.**
→ *Recomiendo:* compartida (las orgs referencian los roles globales). Un cambio
de la plataforma aplica a todas las orgs al instante, como sugiere la pantalla
de roles. Alternativa: copiar la plantilla al crear cada org (los cambios solo
afectan a las orgs nuevas).

**P11. Cancelar un sorteo con ventas.**
→ *Recomiendo:* permiso `raffles.publish` + motivo; vencen las órdenes
`reserved`, las pagadas se conservan (el reembolso es externo), se notifica por
WhatsApp a quienes tienen números pagados y queda en auditoría. ¿Prefieres que
cancelar requiera `raffles.delete` (solo owner)?

**P12. Código de boleto `RS-0042-07`.**
→ *Recomiendo:* `0042` = número consecutivo del sorteo dentro de la org y `07`
= el número con las cifras del sorteo (`RS-0042-0715` en 4 cifras). Es único por org.

**Otras decisiones menores que tomé** (avísame si alguna no te sirve):
- `Raffle.salesCloseAt` como campo estructurado: la regla 4 necesita una hora
  límite real, y el texto de condición sigue siendo libre.
- `RafflePaymentAccount`: cada sorteo elige qué cuentas mostrar (por defecto, todas las activas).
- `Participant.nickname`: necesario para el formato «apodo»; se pide como campo opcional al apartar.
- El token de «Mis boletos» dura 30 min. El OTP dura 10 min, con 5 intentos.
- La comisión de vendedores (la menciona la pantalla de planes) **no** está en el documento, así que solo atribuyo las ventas y no calculo comisiones.
