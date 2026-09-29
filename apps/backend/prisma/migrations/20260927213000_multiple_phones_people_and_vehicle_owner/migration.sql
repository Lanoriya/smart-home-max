ALTER TABLE "resident_profiles" ADD COLUMN "phones" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
UPDATE "resident_profiles" SET "phones" = ARRAY["phone"] WHERE "phone" IS NOT NULL;
ALTER TABLE "resident_profiles" DROP COLUMN "phone";

CREATE TABLE "resident_people" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "profile_id" UUID NOT NULL,
  "full_name" TEXT NOT NULL,
  "phones" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  CONSTRAINT "resident_people_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "resident_people_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "resident_profiles"("id") ON DELETE CASCADE
);
CREATE INDEX "resident_people_profile_id_idx" ON "resident_people"("profile_id");

ALTER TABLE "vehicles" ADD COLUMN "owner_person_id" UUID;
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_owner_person_id_fkey" FOREIGN KEY ("owner_person_id") REFERENCES "resident_people"("id") ON DELETE SET NULL;
