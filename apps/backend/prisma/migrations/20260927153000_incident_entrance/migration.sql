ALTER TABLE "buildings"
ADD COLUMN "entrances_count" INTEGER NOT NULL DEFAULT 3;

ALTER TABLE "incidents"
ADD COLUMN "entrance_number" INTEGER;

ALTER TABLE "buildings"
ADD CONSTRAINT "buildings_entrances_count_check"
CHECK ("entrances_count" BETWEEN 1 AND 20);

ALTER TABLE "incidents"
ADD CONSTRAINT "incidents_entrance_number_check"
CHECK ("entrance_number" IS NULL OR "entrance_number" BETWEEN 1 AND 20);
