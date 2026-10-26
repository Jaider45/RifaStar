-- CreateEnum
CREATE TYPE "NumberSelection" AS ENUM ('choose', 'random');

-- CreateEnum
CREATE TYPE "ExtraDigitsSource" AS ENUM ('series', 'fifth_digit');

-- CreateEnum
CREATE TYPE "ExtraDigitsPosition" AS ENUM ('start', 'end');

-- CreateEnum
CREATE TYPE "LotteryResultStatus" AS ENUM ('confirmed', 'preliminary', 'disputed');

-- AlterTable
ALTER TABLE "draw_results" ADD COLUMN     "fifth_digit" TEXT,
ADD COLUMN     "managers_notified_revision" INTEGER,
ADD COLUMN     "series_result" TEXT;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "receipt_sha256" TEXT;

-- AlterTable
ALTER TABLE "prizes" ADD COLUMN     "anticipated_draw_code" TEXT,
ADD COLUMN     "image_key" TEXT;

-- AlterTable
ALTER TABLE "raffle_numbers" ALTER COLUMN "status" SET DEFAULT 'reserved';

-- AlterTable
ALTER TABLE "raffles" ADD COLUMN     "extra_digits_position" "ExtraDigitsPosition" NOT NULL DEFAULT 'end',
ADD COLUMN     "extra_digits_source" "ExtraDigitsSource",
ADD COLUMN     "gallery_keys" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "lottery_draw_code" TEXT,
ADD COLUMN     "lottery_result_notified_at" TIMESTAMPTZ,
ADD COLUMN     "number_selection" "NumberSelection" NOT NULL DEFAULT 'choose',
ADD COLUMN     "page_config" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "phone" TEXT,
ADD COLUMN     "phone_verified_at" TIMESTAMPTZ;

-- AlterTable
ALTER TABLE "winners" ADD COLUMN     "reminder_sent_at" TIMESTAMPTZ;

-- CreateTable
CREATE TABLE "known_devices" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "device_hash" TEXT NOT NULL,
    "user_agent" TEXT,
    "ip" INET,
    "first_seen_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "known_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lottery_results" (
    "id" UUID NOT NULL,
    "draw_code" TEXT NOT NULL,
    "draw_name" TEXT NOT NULL,
    "draw_date" DATE NOT NULL,
    "winning_number" TEXT,
    "winning_series" TEXT,
    "fifth_digit" TEXT,
    "status" "LotteryResultStatus" NOT NULL,
    "published_at" TIMESTAMPTZ,
    "raw" JSONB NOT NULL,
    "received_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "lottery_results_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "known_devices_user_id_device_hash_key" ON "known_devices"("user_id", "device_hash");

-- CreateIndex
CREATE UNIQUE INDEX "lottery_results_draw_code_draw_date_key" ON "lottery_results"("draw_code", "draw_date");

-- CreateIndex
CREATE INDEX "orders_organization_id_receipt_sha256_idx" ON "orders"("organization_id", "receipt_sha256");

-- AddForeignKey
ALTER TABLE "known_devices" ADD CONSTRAINT "known_devices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- =============================================================================
-- Restricciones, modelo de números tomados y permisos (escrito a mano)
-- =============================================================================

-- Sorteos de 2 a 6 cifras (100 a 1.000.000 de números).
ALTER TABLE "raffles" DROP CONSTRAINT "raffles_digits";
ALTER TABLE "raffles" ADD CONSTRAINT "raffles_digits" CHECK (digits BETWEEN 2 AND 6);
ALTER TABLE "raffles" ADD CONSTRAINT "raffles_extra_digits" CHECK (
  (digits <= 4 AND extra_digits_source IS NULL)
  OR (digits = 5 AND extra_digits_source IS NOT NULL)
  OR (digits = 6 AND extra_digits_source = 'series')
);
ALTER TABLE "raffles" ADD CONSTRAINT "raffles_accent_format"
  CHECK (accent_color IS NULL OR accent_color ~ '^#[0-9a-fA-F]{6}$');

-- raffle_numbers guarda solo los números tomados: un número sin fila está libre.
DELETE FROM "raffle_numbers" WHERE status = 'available';
ALTER TABLE "raffle_numbers" DROP CONSTRAINT "raffle_numbers_holder";
ALTER TABLE "raffle_numbers" ADD CONSTRAINT "raffle_numbers_taken"
  CHECK (status <> 'available' AND order_id IS NOT NULL);
ALTER TABLE "raffle_numbers" DROP CONSTRAINT "raffle_numbers_range";
ALTER TABLE "raffle_numbers" ADD CONSTRAINT "raffle_numbers_range" CHECK (number >= 0 AND number < 1000000);

ALTER TABLE "draw_results" ADD CONSTRAINT "draw_results_series_format"
  CHECK (series_result IS NULL OR series_result ~ '^\d{3}$');
ALTER TABLE "draw_results" ADD CONSTRAINT "draw_results_fifth_digit_format"
  CHECK (fifth_digit IS NULL OR fifth_digit ~ '^\d$');

ALTER TABLE "users" ADD CONSTRAINT "users_phone_format" CHECK (phone IS NULL OR phone ~ '^\+[1-9]\d{6,14}$');

-- Tablas nuevas sin organización: known_devices solo la usa el rol del sistema;
-- lottery_results es de lectura para la app (los resultados son públicos).
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'rifastar_system') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON known_devices, lottery_results TO rifastar_system;
  END IF;
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'rifastar_app') THEN
    GRANT SELECT ON lottery_results TO rifastar_app;
  END IF;
END
$$;
