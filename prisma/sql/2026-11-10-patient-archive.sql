-- Archived patients: hidden from the doctor's lists and unable to sign in; records kept and restorable.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "archivedAt" TIMESTAMP(3);
