-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "btree_gist";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "citext";

-- CreateEnum
CREATE TYPE "PlatformRole" AS ENUM ('super_admin', 'support', 'finance');

-- CreateEnum
CREATE TYPE "OrgStatus" AS ENUM ('trial', 'active', 'past_due', 'suspended');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('trialing', 'active', 'past_due', 'canceled', 'incomplete');

-- CreateEnum
CREATE TYPE "BillingProviderKind" AS ENUM ('stripe', 'wompi', 'mercadopago', 'manual');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('open', 'paid', 'failed', 'void');

-- CreateEnum
CREATE TYPE "TrialExpiryAction" AS ENUM ('downgrade_to_plan', 'block_new_raffles');

-- CreateEnum
CREATE TYPE "MemberStatus" AS ENUM ('invited', 'active', 'removed');

-- CreateEnum
CREATE TYPE "SettingsSection" AS ENUM ('payments', 'ranking', 'notifications', 'branding');

-- CreateEnum
CREATE TYPE "PaymentAccountType" AS ENUM ('bre_b', 'nequi', 'daviplata', 'bank_transfer');

-- CreateEnum
CREATE TYPE "RaffleStatus" AS ENUM ('draft', 'active', 'sold_out', 'closed', 'drawn', 'cancelled');

-- CreateEnum
CREATE TYPE "PrizeRule" AS ENUM ('last_two', 'first_two', 'middle_two', 'digits_1_and_4', 'anticipated_last_two', 'custom', 'last_three', 'first_three', 'full_number', 'anticipated_full_number');

-- CreateEnum
CREATE TYPE "NumberStatus" AS ENUM ('available', 'reserved', 'pending_verification', 'paid');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('reserved', 'pending_verification', 'approved', 'rejected', 'expired', 'released');

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('valid', 'void');

-- CreateEnum
CREATE TYPE "PrizeDeliveryStatus" AS ENUM ('pending', 'delivered');

-- CreateEnum
CREATE TYPE "RankingFrequency" AS ENUM ('monthly', 'biweekly', 'weekly');

-- CreateEnum
CREATE TYPE "RankingPeriodStatus" AS ENUM ('open', 'closed');

-- CreateEnum
CREATE TYPE "PointsReason" AS ENUM ('number_paid', 'consistency_bonus', 'referral_bonus', 'manual_adjustment');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('queued', 'sent', 'delivered', 'read', 'failed', 'skipped_quota', 'skipped_disabled');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('platform_user', 'user', 'participant', 'system');

-- CreateEnum
CREATE TYPE "SessionSubject" AS ENUM ('user', 'platform_user');

-- CreateEnum
CREATE TYPE "UsageMetric" AS ENUM ('whatsapp_messages');

-- CreateTable
CREATE TABLE "platform_users" (
    "id" UUID NOT NULL,
    "email" CITEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "PlatformRole" NOT NULL,
    "password_hash" TEXT NOT NULL,
    "totp_secret_enc" TEXT,
    "totp_enabled_at" TIMESTAMPTZ,
    "last_login_at" TIMESTAMPTZ,
    "disabled_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "platform_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_role_permissions" (
    "role" "PlatformRole" NOT NULL,
    "permission_key" TEXT NOT NULL,

    CONSTRAINT "platform_role_permissions_pkey" PRIMARY KEY ("role","permission_key")
);

-- CreateTable
CREATE TABLE "plans" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "monthly_price_cop" INTEGER NOT NULL,
    "max_active_raffles" INTEGER,
    "max_members" INTEGER NOT NULL,
    "monthly_whatsapp_messages" INTEGER NOT NULL,
    "feature_ranking" BOOLEAN NOT NULL DEFAULT false,
    "feature_whatsapp_automation" BOOLEAN NOT NULL DEFAULT false,
    "feature_sellers" BOOLEAN NOT NULL DEFAULT false,
    "feature_custom_roles" BOOLEAN NOT NULL DEFAULT false,
    "feature_custom_domain" BOOLEAN NOT NULL DEFAULT false,
    "feature_white_label" BOOLEAN NOT NULL DEFAULT false,
    "external_price_ids" JSONB NOT NULL DEFAULT '{}',
    "highlighted" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "archived_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trial_config" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "plan_id" UUID NOT NULL,
    "days" INTEGER NOT NULL,
    "on_expire" "TrialExpiryAction" NOT NULL,
    "downgrade_plan_id" UUID,
    "past_due_grace_days" INTEGER NOT NULL DEFAULT 7,
    "updated_by_id" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "trial_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" BIGSERIAL NOT NULL,
    "actor_type" "ActorType" NOT NULL,
    "actor_id" UUID,
    "actor_label" TEXT,
    "organization_id" UUID,
    "support_session_id" UUID,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT,
    "before" JSONB,
    "after" JSONB,
    "ip" INET,
    "user_agent" TEXT,
    "request_id" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_sessions" (
    "id" UUID NOT NULL,
    "platform_user_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "ended_at" TIMESTAMPTZ,
    "ip" INET,

    CONSTRAINT "support_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "subject_type" "SessionSubject" NOT NULL,
    "user_id" UUID,
    "platform_user_id" UUID,
    "family_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "rotated_at" TIMESTAMPTZ,
    "revoked_at" TIMESTAMPTZ,
    "ip" INET,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "status" "SubscriptionStatus" NOT NULL,
    "provider" "BillingProviderKind" NOT NULL,
    "external_customer_id" TEXT,
    "external_subscription_id" TEXT,
    "current_period_start" TIMESTAMPTZ,
    "current_period_end" TIMESTAMPTZ,
    "trial_ends_at" TIMESTAMPTZ,
    "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
    "past_due_since" TIMESTAMPTZ,
    "canceled_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "subscription_id" UUID NOT NULL,
    "provider" "BillingProviderKind" NOT NULL,
    "external_id" TEXT NOT NULL,
    "amount_cop" INTEGER NOT NULL,
    "status" "InvoiceStatus" NOT NULL,
    "attempted_at" TIMESTAMPTZ,
    "paid_at" TIMESTAMPTZ,
    "failure_reason" TEXT,
    "period_start" TIMESTAMPTZ,
    "period_end" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_events" (
    "id" UUID NOT NULL,
    "provider" "BillingProviderKind" NOT NULL,
    "external_event_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "received_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,

    CONSTRAINT "billing_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" CITEXT NOT NULL,
    "support_whatsapp" TEXT,
    "logo_key" TEXT,
    "default_accent_color" TEXT NOT NULL DEFAULT '#7eb742',
    "custom_domain" CITEXT,
    "custom_domain_verified_at" TIMESTAMPTZ,
    "timezone" TEXT NOT NULL DEFAULT 'America/Bogota',
    "status" "OrgStatus" NOT NULL DEFAULT 'trial',
    "trial_ends_at" TIMESTAMPTZ,
    "suspended_at" TIMESTAMPTZ,
    "suspension_reason" TEXT,
    "raffle_sequence" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" CITEXT NOT NULL,
    "name" TEXT NOT NULL,
    "password_hash" TEXT,
    "totp_secret_enc" TEXT,
    "totp_enabled_at" TIMESTAMPTZ,
    "email_verified_at" TIMESTAMPTZ,
    "last_login_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "used_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "members" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "status" "MemberStatus" NOT NULL DEFAULT 'invited',
    "seller_code" CITEXT,
    "invite_token_hash" TEXT,
    "invite_expires_at" TIMESTAMPTZ,
    "invited_by_id" UUID,
    "joined_at" TIMESTAMPTZ,
    "last_access_at" TIMESTAMPTZ,
    "removed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "organization_id" UUID,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "key" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "group" TEXT NOT NULL,
    "description" TEXT NOT NULL,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "role_id" UUID NOT NULL,
    "permission_key" TEXT NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id","permission_key")
);

-- CreateTable
CREATE TABLE "org_settings" (
    "organization_id" UUID NOT NULL,
    "section" "SettingsSection" NOT NULL,
    "schema_version" INTEGER NOT NULL DEFAULT 1,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "data" JSONB NOT NULL,
    "updated_by_id" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "org_settings_pkey" PRIMARY KEY ("organization_id","section")
);

-- CreateTable
CREATE TABLE "payment_accounts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "type" "PaymentAccountType" NOT NULL,
    "key_or_number" TEXT NOT NULL,
    "holder_name" TEXT NOT NULL,
    "bank_name" TEXT,
    "account_kind" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "payment_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "raffles" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "slug" CITEXT NOT NULL,
    "title" TEXT NOT NULL,
    "lottery" TEXT NOT NULL,
    "draw_at" TIMESTAMPTZ NOT NULL,
    "sales_close_at" TIMESTAMPTZ,
    "cover_image_key" TEXT,
    "price_per_number" INTEGER NOT NULL,
    "digits" INTEGER NOT NULL,
    "total_numbers" INTEGER NOT NULL,
    "min_per_order" INTEGER NOT NULL DEFAULT 1,
    "accent_color" TEXT,
    "condition_text" TEXT,
    "authorization_number" TEXT,
    "status" "RaffleStatus" NOT NULL DEFAULT 'draft',
    "paid_count" INTEGER NOT NULL DEFAULT 0,
    "held_count" INTEGER NOT NULL DEFAULT 0,
    "published_at" TIMESTAMPTZ,
    "closed_at" TIMESTAMPTZ,
    "drawn_at" TIMESTAMPTZ,
    "results_published_at" TIMESTAMPTZ,
    "cancelled_at" TIMESTAMPTZ,
    "cancel_reason" TEXT,
    "duplicated_from_id" UUID,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "raffles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "raffle_payment_accounts" (
    "raffle_id" UUID NOT NULL,
    "payment_account_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,

    CONSTRAINT "raffle_payment_accounts_pkey" PRIMARY KEY ("raffle_id","payment_account_id")
);

-- CreateTable
CREATE TABLE "prizes" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "raffle_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "amount_cop" INTEGER,
    "description" TEXT,
    "rule" "PrizeRule" NOT NULL,
    "custom_rule_text" TEXT,
    "anticipated_lottery" TEXT,
    "anticipated_draw_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prizes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "raffle_numbers" (
    "raffle_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "organization_id" UUID NOT NULL,
    "status" "NumberStatus" NOT NULL DEFAULT 'available',
    "order_id" UUID,
    "reserved_until" TIMESTAMPTZ,
    "paid_at" TIMESTAMPTZ,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "raffle_numbers_pkey" PRIMARY KEY ("raffle_id","number")
);

-- CreateTable
CREATE TABLE "participants" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "phone" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nickname" TEXT,
    "referral_code" TEXT,
    "referred_by_id" UUID,
    "first_seen_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "raffle_id" UUID NOT NULL,
    "participant_id" UUID NOT NULL,
    "numbers" INTEGER[],
    "unit_price" INTEGER NOT NULL,
    "total_cop" INTEGER NOT NULL,
    "seller_member_id" UUID,
    "seller_code" TEXT,
    "status" "OrderStatus" NOT NULL DEFAULT 'reserved',
    "reserved_until" TIMESTAMPTZ NOT NULL,
    "access_token_hash" TEXT NOT NULL,
    "idempotency_key" TEXT,
    "receipt_key" TEXT,
    "receipt_mime" TEXT,
    "receipt_size" INTEGER,
    "receipt_uploaded_at" TIMESTAMPTZ,
    "verified_by_id" UUID,
    "verified_at" TIMESTAMPTZ,
    "rejection_reason" TEXT,
    "released_by_id" UUID,
    "released_at" TIMESTAMPTZ,
    "release_reason" TEXT,
    "expired_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tickets" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "raffle_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "participant_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "status" "TicketStatus" NOT NULL DEFAULT 'valid',
    "issued_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voided_at" TIMESTAMPTZ,

    CONSTRAINT "tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notify_me_subscriptions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "participant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unsubscribed_at" TIMESTAMPTZ,
    "last_notified_at" TIMESTAMPTZ,

    CONSTRAINT "notify_me_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "otp_challenges" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "phone" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "consumed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otp_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "draw_results" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "raffle_id" UUID NOT NULL,
    "main_result" TEXT NOT NULL,
    "anticipated_result" TEXT,
    "custom_winners" JSONB,
    "evidence_keys" TEXT[],
    "entered_by_id" UUID NOT NULL,
    "entered_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "published_at" TIMESTAMPTZ,
    "winners_notified_at" TIMESTAMPTZ,

    CONSTRAINT "draw_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "winners" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "raffle_id" UUID NOT NULL,
    "prize_id" UUID NOT NULL,
    "draw_result_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "unsold" BOOLEAN NOT NULL DEFAULT false,
    "participant_id" UUID,
    "ticket_id" UUID,
    "delivery_status" "PrizeDeliveryStatus" NOT NULL DEFAULT 'pending',
    "delivered_at" TIMESTAMPTZ,
    "delivered_by_id" UUID,
    "delivery_note" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "winners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ranking_periods" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "frequency" "RankingFrequency" NOT NULL,
    "label" TEXT NOT NULL,
    "starts_at" TIMESTAMPTZ NOT NULL,
    "ends_at" TIMESTAMPTZ NOT NULL,
    "status" "RankingPeriodStatus" NOT NULL DEFAULT 'open',
    "closed_at" TIMESTAMPTZ,
    "snapshot" JSONB,
    "config_snapshot" JSONB,
    "announced_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ranking_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "points_events" (
    "id" BIGSERIAL NOT NULL,
    "organization_id" UUID NOT NULL,
    "period_id" UUID NOT NULL,
    "participant_id" UUID NOT NULL,
    "points" INTEGER NOT NULL,
    "reason" "PointsReason" NOT NULL,
    "order_id" UUID,
    "raffle_id" UUID,
    "actor_member_id" UUID,
    "note" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "points_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_logs" (
    "id" UUID NOT NULL,
    "organization_id" UUID,
    "template" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'whatsapp',
    "to_phone" TEXT NOT NULL,
    "participant_id" UUID,
    "variables" JSONB,
    "status" "MessageStatus" NOT NULL DEFAULT 'queued',
    "provider" TEXT NOT NULL DEFAULT 'meta_cloud',
    "provider_message_id" TEXT,
    "error" TEXT,
    "quota_units" INTEGER NOT NULL DEFAULT 1,
    "quota_period" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMPTZ,
    "delivered_at" TIMESTAMPTZ,
    "read_at" TIMESTAMPTZ,

    CONSTRAINT "message_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usage_counters" (
    "organization_id" UUID NOT NULL,
    "metric" "UsageMetric" NOT NULL,
    "period" TEXT NOT NULL,
    "used" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "usage_counters_pkey" PRIMARY KEY ("organization_id","metric","period")
);

-- CreateTable
CREATE TABLE "job_runs" (
    "job" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "completed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_runs_pkey" PRIMARY KEY ("job","key")
);

-- CreateIndex
CREATE UNIQUE INDEX "platform_users_email_key" ON "platform_users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "plans_code_key" ON "plans"("code");

-- CreateIndex
CREATE INDEX "audit_logs_organization_id_created_at_idx" ON "audit_logs"("organization_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_actor_type_actor_id_created_at_idx" ON "audit_logs"("actor_type", "actor_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_action_created_at_idx" ON "audit_logs"("action", "created_at" DESC);

-- CreateIndex
CREATE INDEX "support_sessions_organization_id_expires_at_idx" ON "support_sessions"("organization_id", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_family_id_idx" ON "refresh_tokens"("family_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_platform_user_id_idx" ON "refresh_tokens"("platform_user_id");

-- CreateIndex
CREATE INDEX "subscriptions_organization_id_idx" ON "subscriptions"("organization_id");

-- CreateIndex
CREATE INDEX "subscriptions_status_idx" ON "subscriptions"("status");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_provider_external_subscription_id_key" ON "subscriptions"("provider", "external_subscription_id");

-- CreateIndex
CREATE INDEX "invoices_status_attempted_at_idx" ON "invoices"("status", "attempted_at");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_provider_external_id_key" ON "invoices"("provider", "external_id");

-- CreateIndex
CREATE INDEX "billing_events_processed_at_idx" ON "billing_events"("processed_at");

-- CreateIndex
CREATE UNIQUE INDEX "billing_events_provider_external_event_id_key" ON "billing_events"("provider", "external_event_id");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_custom_domain_key" ON "organizations"("custom_domain");

-- CreateIndex
CREATE INDEX "organizations_status_idx" ON "organizations"("status");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_token_hash_key" ON "password_reset_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "password_reset_tokens_user_id_idx" ON "password_reset_tokens"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "members_invite_token_hash_key" ON "members"("invite_token_hash");

-- CreateIndex
CREATE INDEX "members_organization_id_status_idx" ON "members"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "members_organization_id_user_id_key" ON "members"("organization_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "members_organization_id_seller_code_key" ON "members"("organization_id", "seller_code");

-- CreateIndex
CREATE UNIQUE INDEX "roles_organization_id_key_key" ON "roles"("organization_id", "key");

-- CreateIndex
CREATE INDEX "payment_accounts_organization_id_is_active_idx" ON "payment_accounts"("organization_id", "is_active");

-- CreateIndex
CREATE INDEX "raffles_organization_id_status_idx" ON "raffles"("organization_id", "status");

-- CreateIndex
CREATE INDEX "raffles_status_sales_close_at_idx" ON "raffles"("status", "sales_close_at");

-- CreateIndex
CREATE INDEX "raffles_status_draw_at_idx" ON "raffles"("status", "draw_at");

-- CreateIndex
CREATE UNIQUE INDEX "raffles_organization_id_slug_key" ON "raffles"("organization_id", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "raffles_organization_id_sequence_key" ON "raffles"("organization_id", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "prizes_raffle_id_position_key" ON "prizes"("raffle_id", "position");

-- CreateIndex
CREATE INDEX "raffle_numbers_raffle_id_status_idx" ON "raffle_numbers"("raffle_id", "status");

-- CreateIndex
CREATE INDEX "raffle_numbers_order_id_idx" ON "raffle_numbers"("order_id");

-- CreateIndex
CREATE INDEX "participants_organization_id_name_idx" ON "participants"("organization_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "participants_organization_id_phone_key" ON "participants"("organization_id", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "participants_organization_id_referral_code_key" ON "participants"("organization_id", "referral_code");

-- CreateIndex
CREATE INDEX "orders_organization_id_status_receipt_uploaded_at_idx" ON "orders"("organization_id", "status", "receipt_uploaded_at");

-- CreateIndex
CREATE INDEX "orders_status_reserved_until_idx" ON "orders"("status", "reserved_until");

-- CreateIndex
CREATE INDEX "orders_raffle_id_status_idx" ON "orders"("raffle_id", "status");

-- CreateIndex
CREATE INDEX "orders_participant_id_idx" ON "orders"("participant_id");

-- CreateIndex
CREATE INDEX "orders_organization_id_seller_member_id_created_at_idx" ON "orders"("organization_id", "seller_member_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "orders_raffle_id_idempotency_key_key" ON "orders"("raffle_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "tickets_participant_id_idx" ON "tickets"("participant_id");

-- CreateIndex
CREATE INDEX "tickets_order_id_idx" ON "tickets"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "notify_me_subscriptions_organization_id_participant_id_key" ON "notify_me_subscriptions"("organization_id", "participant_id");

-- CreateIndex
CREATE INDEX "otp_challenges_organization_id_phone_created_at_idx" ON "otp_challenges"("organization_id", "phone", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "draw_results_raffle_id_key" ON "draw_results"("raffle_id");

-- CreateIndex
CREATE INDEX "winners_raffle_id_idx" ON "winners"("raffle_id");

-- CreateIndex
CREATE UNIQUE INDEX "winners_prize_id_number_key" ON "winners"("prize_id", "number");

-- CreateIndex
CREATE INDEX "ranking_periods_organization_id_status_idx" ON "ranking_periods"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ranking_periods_organization_id_starts_at_key" ON "ranking_periods"("organization_id", "starts_at");

-- CreateIndex
CREATE UNIQUE INDEX "ranking_periods_organization_id_label_key" ON "ranking_periods"("organization_id", "label");

-- CreateIndex
CREATE UNIQUE INDEX "points_events_idempotency_key_key" ON "points_events"("idempotency_key");

-- CreateIndex
CREATE INDEX "points_events_period_id_participant_id_created_at_idx" ON "points_events"("period_id", "participant_id", "created_at");

-- CreateIndex
CREATE INDEX "points_events_organization_id_created_at_idx" ON "points_events"("organization_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "message_logs_provider_message_id_key" ON "message_logs"("provider_message_id");

-- CreateIndex
CREATE UNIQUE INDEX "message_logs_idempotency_key_key" ON "message_logs"("idempotency_key");

-- CreateIndex
CREATE INDEX "message_logs_organization_id_created_at_idx" ON "message_logs"("organization_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "message_logs_organization_id_quota_period_status_idx" ON "message_logs"("organization_id", "quota_period", "status");

-- AddForeignKey
ALTER TABLE "trial_config" ADD CONSTRAINT "trial_config_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trial_config" ADD CONSTRAINT "trial_config_downgrade_plan_id_fkey" FOREIGN KEY ("downgrade_plan_id") REFERENCES "plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_sessions" ADD CONSTRAINT "support_sessions_platform_user_id_fkey" FOREIGN KEY ("platform_user_id") REFERENCES "platform_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_sessions" ADD CONSTRAINT "support_sessions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "members" ADD CONSTRAINT "members_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "members" ADD CONSTRAINT "members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "members" ADD CONSTRAINT "members_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_key_fkey" FOREIGN KEY ("permission_key") REFERENCES "permissions"("key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_settings" ADD CONSTRAINT "org_settings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_accounts" ADD CONSTRAINT "payment_accounts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "raffles" ADD CONSTRAINT "raffles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "raffle_payment_accounts" ADD CONSTRAINT "raffle_payment_accounts_raffle_id_fkey" FOREIGN KEY ("raffle_id") REFERENCES "raffles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "raffle_payment_accounts" ADD CONSTRAINT "raffle_payment_accounts_payment_account_id_fkey" FOREIGN KEY ("payment_account_id") REFERENCES "payment_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prizes" ADD CONSTRAINT "prizes_raffle_id_fkey" FOREIGN KEY ("raffle_id") REFERENCES "raffles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "raffle_numbers" ADD CONSTRAINT "raffle_numbers_raffle_id_fkey" FOREIGN KEY ("raffle_id") REFERENCES "raffles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "raffle_numbers" ADD CONSTRAINT "raffle_numbers_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "participants" ADD CONSTRAINT "participants_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "participants" ADD CONSTRAINT "participants_referred_by_id_fkey" FOREIGN KEY ("referred_by_id") REFERENCES "participants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_raffle_id_fkey" FOREIGN KEY ("raffle_id") REFERENCES "raffles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "participants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_seller_member_id_fkey" FOREIGN KEY ("seller_member_id") REFERENCES "members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_raffle_id_fkey" FOREIGN KEY ("raffle_id") REFERENCES "raffles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "participants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "draw_results" ADD CONSTRAINT "draw_results_raffle_id_fkey" FOREIGN KEY ("raffle_id") REFERENCES "raffles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "winners" ADD CONSTRAINT "winners_raffle_id_fkey" FOREIGN KEY ("raffle_id") REFERENCES "raffles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "winners" ADD CONSTRAINT "winners_prize_id_fkey" FOREIGN KEY ("prize_id") REFERENCES "prizes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "winners" ADD CONSTRAINT "winners_draw_result_id_fkey" FOREIGN KEY ("draw_result_id") REFERENCES "draw_results"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "winners" ADD CONSTRAINT "winners_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "participants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "winners" ADD CONSTRAINT "winners_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ranking_periods" ADD CONSTRAINT "ranking_periods_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "points_events" ADD CONSTRAINT "points_events_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "ranking_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "points_events" ADD CONSTRAINT "points_events_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "participants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "points_events" ADD CONSTRAINT "points_events_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

