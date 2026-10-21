-- Reception of residents and days off of a management company.
ALTER TABLE "management_companies" ADD COLUMN "reception_hours" TEXT;
ALTER TABLE "management_companies" ADD COLUMN "days_off" TEXT;

-- Contract (personal account) number of an apartment: all zeros until the
-- company puts the real ones in.
ALTER TABLE "apartments" ADD COLUMN "contract_number" TEXT NOT NULL DEFAULT '0000000000';

-- One-time links from the mini-app to the web desk.
CREATE TABLE "admin_login_links" (
    "id" UUID NOT NULL,
    "admin_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "admin_login_links_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "admin_login_links_token_hash_key" ON "admin_login_links"("token_hash");
CREATE INDEX "admin_login_links_expires_at_idx" ON "admin_login_links"("expires_at");
ALTER TABLE "admin_login_links" ADD CONSTRAINT "admin_login_links_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "admins"("id") ON DELETE CASCADE ON UPDATE CASCADE;
