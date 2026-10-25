-- =============================================================================
-- Restricciones que Prisma no expresa, inmutabilidad de libros, RLS y permisos
-- de los roles de base de datos (ver docker/postgres/01-roles.sql).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- CHECKs e índices parciales
-- -----------------------------------------------------------------------------
ALTER TABLE "trial_config" ADD CONSTRAINT "trial_config_singleton" CHECK (id = 1);
ALTER TABLE "trial_config" ADD CONSTRAINT "trial_config_days" CHECK (days > 0 AND past_due_grace_days >= 0);

ALTER TABLE "organizations" ADD CONSTRAINT "organizations_slug_format"
  CHECK (slug ~ '^[a-z0-9](-?[a-z0-9])+$' AND length(slug) BETWEEN 3 AND 40);

CREATE UNIQUE INDEX "subscriptions_one_current_per_org"
  ON "subscriptions" (organization_id) WHERE status <> 'canceled';

CREATE UNIQUE INDEX "roles_template_key" ON "roles" (key) WHERE organization_id IS NULL;

ALTER TABLE "plans" ADD CONSTRAINT "plans_limits" CHECK (
  monthly_price_cop >= 0 AND (max_active_raffles IS NULL OR max_active_raffles >= 0)
  AND max_members >= 1 AND monthly_whatsapp_messages >= 0
);

ALTER TABLE "raffles" ADD CONSTRAINT "raffles_digits" CHECK (digits IN (2, 3, 4));
ALTER TABLE "raffles" ADD CONSTRAINT "raffles_total_numbers" CHECK (total_numbers = (10 ^ digits)::int);
ALTER TABLE "raffles" ADD CONSTRAINT "raffles_amounts" CHECK (
  price_per_number > 0 AND min_per_order >= 1 AND paid_count >= 0 AND held_count >= 0
  AND paid_count + held_count <= total_numbers
);

ALTER TABLE "prizes" ADD CONSTRAINT "prizes_amount_or_description"
  CHECK (amount_cop IS NOT NULL OR description IS NOT NULL);
ALTER TABLE "prizes" ADD CONSTRAINT "prizes_amount_positive" CHECK (amount_cop IS NULL OR amount_cop > 0);
ALTER TABLE "prizes" ADD CONSTRAINT "prizes_anticipated_lottery" CHECK (
  rule NOT IN ('anticipated_last_two', 'anticipated_full_number') OR anticipated_lottery IS NOT NULL
);

ALTER TABLE "raffle_numbers" ADD CONSTRAINT "raffle_numbers_range" CHECK (number >= 0 AND number < 10000);
ALTER TABLE "raffle_numbers" ADD CONSTRAINT "raffle_numbers_holder"
  CHECK ((status = 'available') = (order_id IS NULL));

ALTER TABLE "orders" ADD CONSTRAINT "orders_amounts" CHECK (
  cardinality(numbers) > 0 AND unit_price > 0 AND total_cop = unit_price * cardinality(numbers)
);

CREATE UNIQUE INDEX "tickets_valid_number" ON "tickets" (raffle_id, number) WHERE status = 'valid';
CREATE UNIQUE INDEX "tickets_valid_code" ON "tickets" (organization_id, code) WHERE status = 'valid';

ALTER TABLE "draw_results" ADD CONSTRAINT "draw_results_main_format" CHECK (main_result ~ '^\d{4}$');
ALTER TABLE "draw_results" ADD CONSTRAINT "draw_results_anticipated_format"
  CHECK (anticipated_result IS NULL OR anticipated_result ~ '^\d{4}$');

ALTER TABLE "winners" ADD CONSTRAINT "winners_unsold" CHECK (unsold = (participant_id IS NULL));

CREATE UNIQUE INDEX "ranking_periods_one_open" ON "ranking_periods" (organization_id) WHERE status = 'open';
ALTER TABLE "ranking_periods" ADD CONSTRAINT "ranking_periods_range" CHECK (ends_at > starts_at);
ALTER TABLE "ranking_periods" ADD CONSTRAINT "ranking_periods_no_overlap"
  EXCLUDE USING gist (organization_id WITH =, tstzrange(starts_at, ends_at) WITH &&);

ALTER TABLE "points_events" ADD CONSTRAINT "points_events_manual_note"
  CHECK (reason <> 'manual_adjustment' OR (note IS NOT NULL AND length(note) > 0));
ALTER TABLE "points_events" ADD CONSTRAINT "points_events_nonzero" CHECK (points <> 0);

ALTER TABLE "usage_counters" ADD CONSTRAINT "usage_counters_used" CHECK (used >= 0);

-- -----------------------------------------------------------------------------
-- Libros inmutables: points_events y audit_logs solo admiten INSERT
-- -----------------------------------------------------------------------------
CREATE FUNCTION rifastar_reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'La tabla % es inmutable (solo inserción)', TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER points_events_immutable BEFORE UPDATE OR DELETE ON "points_events"
  FOR EACH ROW EXECUTE FUNCTION rifastar_reject_mutation();
CREATE TRIGGER points_events_no_truncate BEFORE TRUNCATE ON "points_events"
  FOR EACH STATEMENT EXECUTE FUNCTION rifastar_reject_mutation();
CREATE TRIGGER audit_logs_immutable BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION rifastar_reject_mutation();
CREATE TRIGGER audit_logs_no_truncate BEFORE TRUNCATE ON "audit_logs"
  FOR EACH STATEMENT EXECUTE FUNCTION rifastar_reject_mutation();

-- -----------------------------------------------------------------------------
-- Row Level Security
-- La organización activa se fija por transacción:
--   SELECT set_config('app.org_id', '<uuid>', true);
-- -----------------------------------------------------------------------------
CREATE FUNCTION app_current_org() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.org_id', true), '')::uuid
$$;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'members', 'org_settings', 'payment_accounts', 'raffles', 'raffle_payment_accounts',
    'prizes', 'raffle_numbers', 'participants', 'orders', 'tickets',
    'notify_me_subscriptions', 'otp_challenges', 'draw_results', 'winners',
    'ranking_periods', 'points_events', 'usage_counters', 'subscriptions', 'invoices',
    'support_sessions'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (organization_id = app_current_org()) '
      'WITH CHECK (organization_id = app_current_org())', t);
  END LOOP;
END
$$;

-- organizations: solo la org activa, sin crear ni borrar desde la app
ALTER TABLE "organizations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "organizations" FORCE ROW LEVEL SECURITY;
CREATE POLICY org_self_select ON "organizations" FOR SELECT USING (id = app_current_org());
CREATE POLICY org_self_update ON "organizations" FOR UPDATE
  USING (id = app_current_org()) WITH CHECK (id = app_current_org());

-- roles: la plantilla (organization_id NULL) es de solo lectura para la app
ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;
CREATE POLICY roles_select ON "roles" FOR SELECT
  USING (organization_id IS NULL OR organization_id = app_current_org());
CREATE POLICY roles_insert ON "roles" FOR INSERT WITH CHECK (organization_id = app_current_org());
CREATE POLICY roles_update ON "roles" FOR UPDATE
  USING (organization_id = app_current_org()) WITH CHECK (organization_id = app_current_org());
CREATE POLICY roles_delete ON "roles" FOR DELETE USING (organization_id = app_current_org());

ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" FORCE ROW LEVEL SECURITY;
CREATE POLICY role_permissions_select ON "role_permissions" FOR SELECT USING (
  EXISTS (SELECT 1 FROM roles r WHERE r.id = role_id
          AND (r.organization_id IS NULL OR r.organization_id = app_current_org())));
CREATE POLICY role_permissions_insert ON "role_permissions" FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM roles r WHERE r.id = role_id AND r.organization_id = app_current_org()));
CREATE POLICY role_permissions_delete ON "role_permissions" FOR DELETE USING (
  EXISTS (SELECT 1 FROM roles r WHERE r.id = role_id AND r.organization_id = app_current_org()));

-- audit_logs y message_logs: la app solo ve y escribe filas de su org
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['audit_logs', 'message_logs']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_select ON %I FOR SELECT USING (organization_id = app_current_org())', t);
    EXECUTE format('CREATE POLICY tenant_insert ON %I FOR INSERT WITH CHECK (organization_id = app_current_org())', t);
  END LOOP;
END
$$;
CREATE POLICY tenant_update ON "message_logs" FOR UPDATE
  USING (organization_id = app_current_org()) WITH CHECK (organization_id = app_current_org());

-- users: la app solo ve a los usuarios que son miembros de la org activa
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "users" FORCE ROW LEVEL SECURITY;
CREATE POLICY users_same_org ON "users" FOR SELECT USING (
  EXISTS (SELECT 1 FROM members m WHERE m.user_id = users.id AND m.organization_id = app_current_org()));

-- -----------------------------------------------------------------------------
-- Permisos de los roles de base de datos (si existen)
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'rifastar_system') THEN
    GRANT USAGE ON SCHEMA public TO rifastar_system;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO rifastar_system;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO rifastar_system;
  END IF;

  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'rifastar_app') THEN
    GRANT USAGE ON SCHEMA public TO rifastar_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON
      members, org_settings, payment_accounts, raffles, raffle_payment_accounts, prizes,
      raffle_numbers, participants, orders, tickets, notify_me_subscriptions, otp_challenges,
      draw_results, winners, ranking_periods, usage_counters, roles, role_permissions,
      message_logs
    TO rifastar_app;
    GRANT SELECT, INSERT ON points_events, audit_logs TO rifastar_app;
    GRANT SELECT, UPDATE ON organizations TO rifastar_app;
    GRANT SELECT ON users, plans, permissions, subscriptions, invoices, support_sessions TO rifastar_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO rifastar_app;
  END IF;
END
$$;
