ALTER TYPE "SettingsSection" ADD VALUE IF NOT EXISTS 'receipts';

ALTER TABLE "organizations"
  ADD COLUMN "receipt_sequence" integer NOT NULL DEFAULT 0;

CREATE TABLE "income_receipts" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL,
  "order_id" uuid NOT NULL,
  "sequence" integer NOT NULL,
  "snapshot" jsonb NOT NULL,
  "issued_by_id" uuid,
  "issued_at" timestamptz NOT NULL DEFAULT now(),
  "voided_at" timestamptz,
  "void_reason" text,
  CONSTRAINT "income_receipts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "income_receipts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "income_receipts_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "income_receipts_sequence_positive" CHECK ("sequence" > 0),
  CONSTRAINT "income_receipts_snapshot_object" CHECK (jsonb_typeof("snapshot") = 'object'),
  CONSTRAINT "income_receipts_void_state" CHECK (("voided_at" IS NULL) = ("void_reason" IS NULL))
);

CREATE UNIQUE INDEX "income_receipts_order_id_key" ON "income_receipts"("order_id");
CREATE UNIQUE INDEX "income_receipts_organization_id_sequence_key" ON "income_receipts"("organization_id", "sequence");
CREATE INDEX "income_receipts_organization_id_issued_at_idx" ON "income_receipts"("organization_id", "issued_at");

ALTER TABLE "income_receipts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "income_receipts" FORCE ROW LEVEL SECURITY;
CREATE POLICY "income_receipts_tenant_isolation" ON "income_receipts"
  USING ("organization_id" = app_current_org())
  WITH CHECK ("organization_id" = app_current_org());

CREATE FUNCTION protect_income_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Los comprobantes emitidos no se pueden eliminar'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.voided_at IS NOT NULL OR NEW.id IS DISTINCT FROM OLD.id
     OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
     OR NEW.order_id IS DISTINCT FROM OLD.order_id
     OR NEW.sequence IS DISTINCT FROM OLD.sequence
     OR NEW.snapshot IS DISTINCT FROM OLD.snapshot
     OR NEW.issued_by_id IS DISTINCT FROM OLD.issued_by_id
     OR NEW.issued_at IS DISTINCT FROM OLD.issued_at
     OR NEW.voided_at IS NULL OR NEW.void_reason IS NULL THEN
    RAISE EXCEPTION 'El comprobante es inmutable; solo se permite anularlo una vez'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER income_receipts_immutable BEFORE UPDATE OR DELETE ON "income_receipts"
  FOR EACH ROW EXECUTE FUNCTION protect_income_receipt();

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'rifastar_system') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "income_receipts" TO rifastar_system;
  END IF;
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'rifastar_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "income_receipts" TO rifastar_app;
  END IF;
END
$$;

INSERT INTO "permissions" ("key", "scope", "group", "description")
VALUES ('receipts.issue', 'org', 'Pagos', 'Emitir y consultar comprobantes de ingreso')
ON CONFLICT ("key") DO UPDATE SET "group" = EXCLUDED."group", "description" = EXCLUDED."description";

INSERT INTO "role_permissions" ("role_id", "permission_key")
SELECT r."id", 'receipts.issue'
FROM "roles" r
WHERE r."organization_id" IS NULL AND r."key" IN ('owner', 'admin', 'payment_verifier')
ON CONFLICT DO NOTHING;
