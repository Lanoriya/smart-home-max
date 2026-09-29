CREATE TABLE "emergency_services" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "name" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "emergency_services_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "emergency_services_created_at_idx" ON "emergency_services"("created_at");
