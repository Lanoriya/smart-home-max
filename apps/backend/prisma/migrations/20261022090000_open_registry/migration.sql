-- Open housing registry (Territory Development Fund open data) and the fields
-- of a house and a company that can be filled in from it.
ALTER TABLE "buildings" ADD COLUMN "fias_guid" TEXT,
ADD COLUMN "floors" INTEGER,
ADD COLUMN "built_year" INTEGER;

ALTER TABLE "management_companies" ADD COLUMN "ogrn" TEXT,
ADD COLUMN "site" TEXT;

CREATE TABLE "registry_companies" (
    "id" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "name_full" TEXT NOT NULL,
    "name_short" TEXT,
    "inn" TEXT,
    "ogrn" TEXT,
    "legal_address" TEXT,
    "actual_address" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "site" TEXT,
    "houses_count" INTEGER,
    CONSTRAINT "registry_companies_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "registry_companies_inn_idx" ON "registry_companies"("inn");
CREATE INDEX "registry_companies_subject_idx" ON "registry_companies"("subject");

CREATE TABLE "registry_houses" (
    "id" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "fias_guid" TEXT,
    "address" TEXT NOT NULL,
    "locality" TEXT,
    "street_key" TEXT NOT NULL,
    "house_key" TEXT NOT NULL,
    "built_year" INTEGER,
    "floors" INTEGER,
    "apartments" INTEGER,
    "residents" INTEGER,
    "total_area" DOUBLE PRECISION,
    CONSTRAINT "registry_houses_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "registry_houses_street_key_house_key_idx" ON "registry_houses"("street_key", "house_key");
