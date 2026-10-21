-- Every building gets its own resident access code instead of one shared code
-- for the whole management company. Existing buildings receive random codes;
-- supervisors can view and change them in the dispatcher panel.
ALTER TABLE "buildings" ADD COLUMN "access_code" TEXT;
UPDATE "buildings"
SET "access_code" = lpad(floor(random() * 10000000000)::bigint::text, 10, '0')
WHERE "access_code" IS NULL;
ALTER TABLE "buildings" ALTER COLUMN "access_code" SET NOT NULL;

DROP TABLE "uk_access_codes";

CREATE TABLE "uk_contacts" (
  "id" TEXT NOT NULL DEFAULT 'main',
  "name" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "email" TEXT,
  "address" TEXT,
  "working_hours" TEXT,
  "note" TEXT,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "uk_contacts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "announcements" (
  "id" UUID NOT NULL,
  "audience" TEXT NOT NULL,
  "building_id" UUID,
  "apartment_id" UUID,
  "text" TEXT NOT NULL,
  "recipients_count" INTEGER NOT NULL,
  "admin_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "announcements_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "announcements_created_at_idx" ON "announcements"("created_at" DESC);
CREATE INDEX "announcements_building_id_created_at_idx" ON "announcements"("building_id", "created_at" DESC);
CREATE INDEX "announcements_apartment_id_created_at_idx" ON "announcements"("apartment_id", "created_at" DESC);
ALTER TABLE "announcements"
  ADD CONSTRAINT "announcements_building_id_fkey"
  FOREIGN KEY ("building_id") REFERENCES "buildings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "announcements"
  ADD CONSTRAINT "announcements_apartment_id_fkey"
  FOREIGN KEY ("apartment_id") REFERENCES "apartments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "announcements"
  ADD CONSTRAINT "announcements_admin_id_fkey"
  FOREIGN KEY ("admin_id") REFERENCES "admins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
