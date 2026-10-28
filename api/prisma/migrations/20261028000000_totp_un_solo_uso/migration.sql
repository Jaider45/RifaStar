-- Cada código de verificación en dos pasos sirve una sola vez (se guarda el último paso aceptado).
ALTER TABLE "users" ADD COLUMN "totp_last_step" INTEGER;
ALTER TABLE "platform_users" ADD COLUMN "totp_last_step" INTEGER;
