-- Incidents a dispatcher registered from a phone call, and the answers of
-- residents after the company marked an incident resolved.

-- CreateEnum
CREATE TYPE "IncidentSource" AS ENUM ('resident', 'phone');

-- AlterTable
ALTER TABLE "incidents" ADD COLUMN "source" "IncidentSource" NOT NULL DEFAULT 'resident',
ADD COLUMN "caller_name" TEXT,
ADD COLUMN "caller_phone" TEXT,
ADD COLUMN "call_note" TEXT;

-- CreateTable
CREATE TABLE "incident_feedback" (
    "id" UUID NOT NULL,
    "incident_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "apartment_id" UUID,
    "resolved" BOOLEAN NOT NULL,
    "rating" INTEGER,
    "comment" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "incident_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "incident_feedback_updated_at_idx" ON "incident_feedback"("updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "incident_feedback_incident_id_user_id_key" ON "incident_feedback"("incident_id", "user_id");

-- AddForeignKey
ALTER TABLE "incident_feedback" ADD CONSTRAINT "incident_feedback_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "incidents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incident_feedback" ADD CONSTRAINT "incident_feedback_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incident_feedback" ADD CONSTRAINT "incident_feedback_apartment_id_fkey" FOREIGN KEY ("apartment_id") REFERENCES "apartments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
