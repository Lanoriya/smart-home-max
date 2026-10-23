-- An employee can switch off the reminders of legal terms for themselves.
ALTER TABLE "admins" ADD COLUMN "legal_reminders" BOOLEAN NOT NULL DEFAULT true;
