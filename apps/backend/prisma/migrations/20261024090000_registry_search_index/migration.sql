-- Search of management companies by any part of the name: trigram indexes let
-- ILIKE '%word%' use an index instead of reading the whole registry.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS "registry_companies_name_full_trgm_idx" ON "registry_companies" USING gin ("name_full" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "registry_companies_name_short_trgm_idx" ON "registry_companies" USING gin ("name_short" gin_trgm_ops);
