-- Several management companies on one platform. The single "main" contact
-- record becomes the first company; every existing building, administrator and
-- announcement is moved into it, so a running installation keeps working.

ALTER TYPE "AdminRole" ADD VALUE 'platform_admin';

CREATE TABLE "management_companies" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "inn" TEXT,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "address" TEXT,
    "working_hours" TEXT,
    "note" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "management_companies_pkey" PRIMARY KEY ("id")
);

-- The first company has a fixed id, the same one the bootstrap and the demo
-- data use.
INSERT INTO "management_companies" ("id", "name", "phone", "email", "address", "working_hours", "note", "updated_at")
SELECT 'c0000000-0000-4000-8000-000000000001', "name", "phone", "email", "address", "working_hours", "note", CURRENT_TIMESTAMP
FROM "uk_contacts" WHERE "id" = 'main';

-- An installation with data but without saved contacts still gets a company
-- to hold its buildings; the supervisor fills in the contacts later. A fresh
-- database gets no company here.
INSERT INTO "management_companies" ("id", "name", "phone", "updated_at")
SELECT 'c0000000-0000-4000-8000-000000000001', 'Управляющая компания', '+7 (000) 000-00-00', CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "management_companies")
  AND (EXISTS (SELECT 1 FROM "buildings") OR EXISTS (SELECT 1 FROM "admins") OR EXISTS (SELECT 1 FROM "announcements"));

ALTER TABLE "buildings" ADD COLUMN "company_id" UUID,
ADD COLUMN "latitude" DOUBLE PRECISION,
ADD COLUMN "longitude" DOUBLE PRECISION;
UPDATE "buildings" SET "company_id" = 'c0000000-0000-4000-8000-000000000001';
ALTER TABLE "buildings" ALTER COLUMN "company_id" SET NOT NULL;

ALTER TABLE "announcements" ADD COLUMN "company_id" UUID;
UPDATE "announcements" SET "company_id" = 'c0000000-0000-4000-8000-000000000001';
ALTER TABLE "announcements" ALTER COLUMN "company_id" SET NOT NULL;

ALTER TABLE "admins" ADD COLUMN "company_id" UUID,
ADD COLUMN "display_name" TEXT,
ADD COLUMN "max_user_id" TEXT;
UPDATE "admins" SET "company_id" = 'c0000000-0000-4000-8000-000000000001';

DROP TABLE "uk_contacts";

CREATE TABLE "admin_invites" (
    "id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "company_id" UUID NOT NULL,
    "role" "AdminRole" NOT NULL,
    "created_by_admin_id" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "used_by_admin_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "admin_invites_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "code_attempts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "code_attempts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "admin_invites_token_hash_key" ON "admin_invites"("token_hash");
CREATE INDEX "admin_invites_company_id_idx" ON "admin_invites"("company_id");
CREATE INDEX "code_attempts_user_id_created_at_idx" ON "code_attempts"("user_id", "created_at");
CREATE UNIQUE INDEX "admins_max_user_id_key" ON "admins"("max_user_id");
CREATE INDEX "announcements_company_id_created_at_idx" ON "announcements"("company_id", "created_at" DESC);
CREATE INDEX "buildings_company_id_idx" ON "buildings"("company_id");

ALTER TABLE "buildings" ADD CONSTRAINT "buildings_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "management_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "management_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "admins" ADD CONSTRAINT "admins_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "management_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "admin_invites" ADD CONSTRAINT "admin_invites_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "management_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "admin_invites" ADD CONSTRAINT "admin_invites_created_by_admin_id_fkey" FOREIGN KEY ("created_by_admin_id") REFERENCES "admins"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "code_attempts" ADD CONSTRAINT "code_attempts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- First reaction of the company to an incident, for the reaction time metric.
-- Filled for existing incidents from their history.
ALTER TABLE "incidents" ADD COLUMN "acknowledged_at" TIMESTAMPTZ(3);
UPDATE "incidents" i SET "acknowledged_at" = e.first_at
FROM (
  SELECT "incident_id", MIN("created_at") AS first_at FROM "incident_events"
  WHERE "type" = 'incident_updated' AND "payload"->>'newStatus' IS DISTINCT FROM 'new'
  GROUP BY "incident_id"
) e
WHERE e."incident_id" = i."id";

-- Emergency numbers: city-wide ones (no company) plus numbers each company adds
-- for its residents. Existing numbers were edited by the single company.
ALTER TABLE "emergency_services" ADD COLUMN "company_id" UUID;
UPDATE "emergency_services" SET "company_id" = 'c0000000-0000-4000-8000-000000000001'
WHERE EXISTS (SELECT 1 FROM "management_companies" WHERE "id" = 'c0000000-0000-4000-8000-000000000001');
ALTER TABLE "emergency_services" ADD CONSTRAINT "emergency_services_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "management_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
