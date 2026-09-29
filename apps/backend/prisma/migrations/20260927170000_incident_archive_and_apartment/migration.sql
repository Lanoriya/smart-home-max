ALTER TABLE "incidents"
ADD COLUMN "apartment_number" TEXT,
ADD COLUMN "rejection_reason" TEXT,
ADD COLUMN "archived_at" TIMESTAMPTZ(3);

CREATE INDEX "incidents_archived_at_updated_at_idx"
ON "incidents" ("archived_at", "updated_at" DESC);
