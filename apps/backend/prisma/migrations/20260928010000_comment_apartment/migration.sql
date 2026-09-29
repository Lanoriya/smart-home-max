ALTER TABLE "incident_comments" ADD COLUMN "apartment_id" UUID;

UPDATE "incident_comments" AS comment
SET "apartment_id" = (
  SELECT "apartment_id"
  FROM "resident_memberships"
  WHERE "user_id" = comment."author_user_id" AND "revoked_at" IS NULL
  ORDER BY "verified_at" DESC
  LIMIT 1
)
WHERE "apartment_id" IS NULL;

ALTER TABLE "incident_comments"
  ADD CONSTRAINT "incident_comments_apartment_id_fkey"
  FOREIGN KEY ("apartment_id") REFERENCES "apartments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "incident_comments_apartment_id_idx" ON "incident_comments"("apartment_id");
