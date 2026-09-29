CREATE TABLE "uk_access_codes" (
  "id" TEXT NOT NULL DEFAULT 'main',
  "code" TEXT NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "uk_access_codes_pkey" PRIMARY KEY ("id")
);
