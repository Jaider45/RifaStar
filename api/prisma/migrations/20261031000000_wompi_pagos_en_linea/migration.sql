-- Pagos en línea con Wompi (checkout propio): cuentas de pasarela por organización (boletas),
-- transacciones, eventos y tarjetas guardadas para renovar el plan de Rifa Star.

-- CreateEnum
CREATE TYPE "GatewayProvider" AS ENUM ('wompi');

-- CreateEnum
CREATE TYPE "GatewayEnvironment" AS ENUM ('sandbox', 'production');

-- CreateEnum
CREATE TYPE "GatewayPaymentPurpose" AS ENUM ('order', 'subscription');

-- CreateEnum
CREATE TYPE "GatewayPaymentStatus" AS ENUM ('pending', 'approved', 'declined', 'voided', 'error');

-- AlterTable
ALTER TABLE "subscriptions" ADD COLUMN     "charge_attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "last_charge_attempt_at" TIMESTAMPTZ,
ADD COLUMN     "payment_source_id" UUID;

-- CreateTable
CREATE TABLE "billing_payment_sources" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "provider" "BillingProviderKind" NOT NULL,
    "external_id" TEXT NOT NULL,
    "brand" TEXT,
    "last_four" TEXT,
    "exp_month" TEXT,
    "exp_year" TEXT,
    "customer_email" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ,

    CONSTRAINT "billing_payment_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gateway_accounts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "provider" "GatewayProvider" NOT NULL DEFAULT 'wompi',
    "environment" "GatewayEnvironment" NOT NULL,
    "public_key" TEXT NOT NULL,
    "private_key_enc" TEXT NOT NULL,
    "integrity_secret_enc" TEXT NOT NULL,
    "events_secret_enc" TEXT NOT NULL,
    "methods" TEXT[],
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "verified_at" TIMESTAMPTZ,
    "last_event_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "gateway_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gateway_payments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "provider" "GatewayProvider" NOT NULL DEFAULT 'wompi',
    "environment" "GatewayEnvironment" NOT NULL,
    "purpose" "GatewayPaymentPurpose" NOT NULL,
    "gateway_account_id" UUID,
    "order_id" UUID,
    "subscription_id" UUID,
    "plan_id" UUID,
    "billing_payment_source_id" UUID,
    "external_id" TEXT,
    "method" TEXT NOT NULL,
    "amount_cop" INTEGER NOT NULL,
    "status" "GatewayPaymentStatus" NOT NULL DEFAULT 'pending',
    "status_message" TEXT,
    "redirect_url" TEXT,
    "customer_email" TEXT NOT NULL,
    "refund_required" BOOLEAN NOT NULL DEFAULT false,
    "last_checked_at" TIMESTAMPTZ,
    "finalized_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "gateway_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gateway_events" (
    "id" UUID NOT NULL,
    "provider" "GatewayProvider" NOT NULL DEFAULT 'wompi',
    "gateway_account_id" UUID,
    "external_event_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "received_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ,
    "last_error" TEXT,

    CONSTRAINT "gateway_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "billing_payment_sources_organization_id_idx" ON "billing_payment_sources"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "billing_payment_sources_provider_external_id_key" ON "billing_payment_sources"("provider", "external_id");

-- CreateIndex
CREATE UNIQUE INDEX "gateway_accounts_organization_id_provider_key" ON "gateway_accounts"("organization_id", "provider");

-- CreateIndex
CREATE INDEX "gateway_payments_status_created_at_idx" ON "gateway_payments"("status", "created_at");

-- CreateIndex
CREATE INDEX "gateway_payments_order_id_idx" ON "gateway_payments"("order_id");

-- CreateIndex
CREATE INDEX "gateway_payments_organization_id_purpose_created_at_idx" ON "gateway_payments"("organization_id", "purpose", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "gateway_payments_provider_external_id_key" ON "gateway_payments"("provider", "external_id");

-- CreateIndex
CREATE INDEX "gateway_events_gateway_account_id_received_at_idx" ON "gateway_events"("gateway_account_id", "received_at");

-- CreateIndex
CREATE UNIQUE INDEX "gateway_events_provider_external_event_id_key" ON "gateway_events"("provider", "external_event_id");

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_payment_source_id_fkey" FOREIGN KEY ("payment_source_id") REFERENCES "billing_payment_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_payment_sources" ADD CONSTRAINT "billing_payment_sources_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gateway_accounts" ADD CONSTRAINT "gateway_accounts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gateway_payments" ADD CONSTRAINT "gateway_payments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gateway_payments" ADD CONSTRAINT "gateway_payments_gateway_account_id_fkey" FOREIGN KEY ("gateway_account_id") REFERENCES "gateway_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gateway_payments" ADD CONSTRAINT "gateway_payments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gateway_payments" ADD CONSTRAINT "gateway_payments_billing_payment_source_id_fkey" FOREIGN KEY ("billing_payment_source_id") REFERENCES "billing_payment_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gateway_payments" ADD CONSTRAINT "gateway_payments_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- -----------------------------------------------------------------------------
-- Reglas que el código asume
-- -----------------------------------------------------------------------------
ALTER TABLE "gateway_payments" ADD CONSTRAINT "gateway_payments_amount_positive" CHECK ("amount_cop" > 0);
ALTER TABLE "gateway_payments" ADD CONSTRAINT "gateway_payments_purpose_target" CHECK (
  ("purpose" = 'order' AND "order_id" IS NOT NULL AND "gateway_account_id" IS NOT NULL)
  OR ("purpose" = 'subscription' AND "plan_id" IS NOT NULL AND "gateway_account_id" IS NULL));
ALTER TABLE "gateway_payments" ADD CONSTRAINT "gateway_payments_method_known"
  CHECK ("method" IN ('CARD', 'NEQUI', 'PSE', 'BANCOLOMBIA_TRANSFER'));
ALTER TABLE "gateway_accounts" ADD CONSTRAINT "gateway_accounts_methods_known"
  CHECK ("methods" <@ ARRAY['CARD', 'NEQUI', 'PSE', 'BANCOLOMBIA_TRANSFER']::text[]);

-- Un solo pago en curso por orden y por plan de cada organización: dos clics no cobran dos veces.
CREATE UNIQUE INDEX "gateway_payments_one_pending_per_order" ON "gateway_payments" ("order_id")
  WHERE "status" = 'pending' AND "purpose" = 'order';
CREATE UNIQUE INDEX "gateway_payments_one_pending_subscription" ON "gateway_payments" ("organization_id")
  WHERE "status" = 'pending' AND "purpose" = 'subscription';

-- -----------------------------------------------------------------------------
-- Row Level Security (mismo patrón que el resto de tablas del tenant)
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['gateway_accounts', 'gateway_payments', 'billing_payment_sources']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (organization_id = app_current_org()) '
      'WITH CHECK (organization_id = app_current_org())', t);
  END LOOP;
END
$$;

-- gateway_events no tiene organización: solo la lee y escribe el rol de sistema (webhooks).
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'rifastar_system') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "gateway_accounts", "gateway_payments", "gateway_events", "billing_payment_sources" TO rifastar_system;
  END IF;
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'rifastar_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "gateway_accounts" TO rifastar_app;
    GRANT SELECT, INSERT, UPDATE ON "gateway_payments" TO rifastar_app;
    GRANT SELECT ON "billing_payment_sources" TO rifastar_app;
  END IF;
END
$$;
