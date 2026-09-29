ALTER TABLE "resident_people" ADD COLUMN "is_vehicle_owner" BOOLEAN NOT NULL DEFAULT false;

UPDATE "resident_people" AS person
SET "is_vehicle_owner" = true
WHERE EXISTS (
  SELECT 1 FROM "vehicles" vehicle WHERE vehicle."owner_person_id" = person."id"
);
