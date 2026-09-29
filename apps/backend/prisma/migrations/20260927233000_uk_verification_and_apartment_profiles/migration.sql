CREATE TYPE "PhoneVisibility" AS ENUM ('hidden', 'vehicle_lookup');

ALTER TABLE "resident_profiles"
  ADD COLUMN "apartment_id" UUID,
  ADD COLUMN "phone_visibility" "PhoneVisibility" NOT NULL DEFAULT 'hidden',
  ADD COLUMN "phone_consent_at" TIMESTAMPTZ(3);

UPDATE "resident_profiles" AS profile
SET "apartment_id" = (
  SELECT "apartment_id"
  FROM "resident_memberships"
  WHERE "user_id" = profile."user_id" AND "revoked_at" IS NULL
  ORDER BY "verified_at" DESC
  LIMIT 1
)
WHERE profile."apartment_id" IS NULL;

-- A profile is shared by one apartment. Keep the most recently edited legacy profile
-- if several MAX accounts had previously saved data for the same apartment.
DELETE FROM "resident_profiles" AS older
USING "resident_profiles" AS newer
WHERE older."apartment_id" = newer."apartment_id"
  AND older."apartment_id" IS NOT NULL
  AND (older."updated_at", older."id") < (newer."updated_at", newer."id");

ALTER TABLE "resident_profiles"
  ALTER COLUMN "user_id" DROP NOT NULL;
ALTER TABLE "resident_profiles" DROP CONSTRAINT "resident_profiles_user_id_fkey";
ALTER TABLE "resident_profiles"
  ADD CONSTRAINT "resident_profiles_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE UNIQUE INDEX "resident_profiles_apartment_id_key" ON "resident_profiles"("apartment_id");
ALTER TABLE "resident_profiles"
  ADD CONSTRAINT "resident_profiles_apartment_id_fkey"
  FOREIGN KEY ("apartment_id") REFERENCES "apartments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "vehicles" ADD COLUMN "apartment_id" UUID;
UPDATE "vehicles" AS vehicle
SET "apartment_id" = (
  SELECT "apartment_id"
  FROM "resident_memberships"
  WHERE "user_id" = vehicle."user_id" AND "revoked_at" IS NULL
  ORDER BY "verified_at" DESC
  LIMIT 1
)
WHERE vehicle."apartment_id" IS NULL;
ALTER TABLE "vehicles"
  ADD CONSTRAINT "vehicles_apartment_id_fkey"
  FOREIGN KEY ("apartment_id") REFERENCES "apartments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "vehicles_apartment_id_idx" ON "vehicles"("apartment_id");
