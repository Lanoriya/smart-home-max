-- The quick dial numbers a company shows to its residents; null means the default list.
ALTER TABLE "management_companies" ADD COLUMN "quick_dial" JSONB;
