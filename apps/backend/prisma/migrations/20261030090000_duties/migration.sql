-- The duties of a company by law as residents see them: the company's own
-- version, else the platform's (platform_settings), else the built-in text.
ALTER TABLE "management_companies" ADD COLUMN "duties" JSONB;

CREATE TABLE "platform_settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("key")
);
