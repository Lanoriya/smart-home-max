ALTER TABLE "buildings"
ADD COLUMN "apartments_count" INTEGER NOT NULL DEFAULT 100;

ALTER TABLE "buildings"
ADD CONSTRAINT "buildings_apartments_count_check"
CHECK ("apartments_count" BETWEEN 1 AND 2000);
