-- City of a house: the bot asks the city first, then the street in it.
ALTER TABLE "buildings" ADD COLUMN "city" TEXT;
CREATE INDEX "buildings_city_idx" ON "buildings"("city");
