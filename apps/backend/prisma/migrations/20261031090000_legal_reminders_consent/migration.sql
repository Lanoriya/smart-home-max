-- Reminders of the legal terms, sent once each.
ALTER TABLE "incidents" ADD COLUMN "legal_soon_notified_at" TIMESTAMPTZ(3);
ALTER TABLE "incidents" ADD COLUMN "legal_late_notified_at" TIMESTAMPTZ(3);

-- When the resident agreed to the processing of personal data.
ALTER TABLE "users" ADD COLUMN "consent_at" TIMESTAMPTZ(3);
