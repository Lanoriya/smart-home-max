-- Buildings get a separate street and house so many streets can be grouped
-- and searched. Existing addresses are split at the trailing house number,
-- for example "ул. Ленина, 10 корп. 2" -> "ул. Ленина" + "10 корп. 2".
ALTER TABLE "buildings" ADD COLUMN "street" TEXT;
ALTER TABLE "buildings" ADD COLUMN "house" TEXT;
UPDATE "buildings"
SET "house" = COALESCE(substring("address" from '(?:^|[\s,])(\d+[^\s,]*(?:[\s,]*(?:корп|корпус|к|стр|строение)\.?\s*\S+)*)\s*$'), '');
UPDATE "buildings"
SET "street" = CASE
  WHEN "house" = '' THEN "address"
  ELSE btrim(regexp_replace(left("address", length("address") - length("house")), '[\s,]*(?:(?:д|дом)\.?)?[\s,]*$', '', 'i'))
END;
UPDATE "buildings" SET "street" = "address" WHERE "street" = '';
-- The display address now always reads "street, house", as the application writes it.
UPDATE "buildings" SET "address" = CASE WHEN "house" = '' THEN "street" ELSE "street" || ', ' || "house" END;
ALTER TABLE "buildings" ALTER COLUMN "street" SET NOT NULL;
ALTER TABLE "buildings" ALTER COLUMN "house" SET NOT NULL;
CREATE INDEX "buildings_street_idx" ON "buildings"("street");

-- Sequential public incident numbers, assigned to existing incidents in the
-- order they were created. The unique index guarantees no number repeats.
ALTER TABLE "incidents" ADD COLUMN "number" INTEGER;
WITH ordered AS (
  SELECT "id", row_number() OVER (ORDER BY "created_at", "id") AS position FROM "incidents"
)
UPDATE "incidents" SET "number" = ordered.position FROM ordered WHERE ordered."id" = "incidents"."id";
CREATE SEQUENCE "incidents_number_seq" OWNED BY "incidents"."number";
SELECT setval('"incidents_number_seq"', COALESCE((SELECT max("number") FROM "incidents"), 0) + 1, false);
ALTER TABLE "incidents" ALTER COLUMN "number" SET DEFAULT nextval('"incidents_number_seq"');
ALTER TABLE "incidents" ALTER COLUMN "number" SET NOT NULL;
CREATE UNIQUE INDEX "incidents_number_key" ON "incidents"("number");

-- Announcements can be addressed to every building on one street.
ALTER TABLE "announcements" ADD COLUMN "street" TEXT;
