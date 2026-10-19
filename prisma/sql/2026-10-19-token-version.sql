-- Tokens issued before an account is paused, its PIN reset or its passkeys removed stop working.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "tokenVersion" INTEGER NOT NULL DEFAULT 0;
