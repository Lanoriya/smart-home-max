-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "IncidentCategory" AS ENUM ('water', 'electricity', 'heating', 'elevator', 'leak', 'cleaning', 'other');

-- CreateEnum
CREATE TYPE "IncidentStatus" AS ENUM ('new', 'acknowledged', 'in_progress', 'resolved', 'rejected');

-- CreateEnum
CREATE TYPE "IncidentPriority" AS ENUM ('low', 'normal', 'high', 'emergency');

-- CreateEnum
CREATE TYPE "AdminRole" AS ENUM ('dispatcher', 'supervisor');

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('pending', 'processing', 'delivered', 'dead');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "max_user_id" TEXT NOT NULL,
    "display_name" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "buildings" (
    "id" UUID NOT NULL,
    "address" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "buildings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "apartments" (
    "id" UUID NOT NULL,
    "building_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "invite_code_hash" TEXT,

    CONSTRAINT "apartments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resident_memberships" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "apartment_id" UUID NOT NULL,
    "verified_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(3),

    CONSTRAINT "resident_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admins" (
    "id" UUID NOT NULL,
    "username" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "AdminRole" NOT NULL DEFAULT 'dispatcher',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incidents" (
    "id" UUID NOT NULL,
    "building_id" UUID NOT NULL,
    "category" "IncidentCategory" NOT NULL,
    "location_zone" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "IncidentStatus" NOT NULL DEFAULT 'new',
    "priority" "IncidentPriority" NOT NULL DEFAULT 'normal',
    "assignee_admin_id" UUID,
    "due_at" TIMESTAMPTZ(3),
    "delay_reason" TEXT,
    "resolved_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "incidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reports" (
    "id" UUID NOT NULL,
    "incident_id" UUID NOT NULL,
    "author_user_id" UUID NOT NULL,
    "apartment_id" UUID,
    "description" TEXT NOT NULL,
    "max_attachment_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incident_subscriptions" (
    "incident_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "incident_subscriptions_pkey" PRIMARY KEY ("incident_id","user_id")
);

-- CreateTable
CREATE TABLE "incident_events" (
    "id" UUID NOT NULL,
    "incident_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "actor_user_id" UUID,
    "actor_admin_id" UUID,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "incident_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bot_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "step" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "bot_sessions_pkey" PRIMARY KEY ("id")
);

-- One active conversation per MAX user.
CREATE UNIQUE INDEX "bot_sessions_user_id_key" ON "bot_sessions"("user_id");

-- CreateTable
CREATE TABLE "processed_updates" (
    "id" TEXT NOT NULL,
    "update_type" TEXT NOT NULL,
    "processed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "processed_updates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_messages" (
    "id" UUID NOT NULL,
    "incident_id" UUID,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_error" TEXT,
    "delivered_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbox_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_max_user_id_key" ON "users"("max_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "apartments_building_id_number_key" ON "apartments"("building_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "resident_memberships_user_id_apartment_id_key" ON "resident_memberships"("user_id", "apartment_id");

-- CreateIndex
CREATE UNIQUE INDEX "admins_username_key" ON "admins"("username");

-- CreateIndex
CREATE INDEX "incidents_building_id_status_updated_at_idx" ON "incidents"("building_id", "status", "updated_at" DESC);

-- CreateIndex
CREATE INDEX "incidents_building_id_category_location_zone_status_idx" ON "incidents"("building_id", "category", "location_zone", "status");

-- CreateIndex
CREATE UNIQUE INDEX "reports_incident_id_author_user_id_key" ON "reports"("incident_id", "author_user_id");

-- CreateIndex
CREATE INDEX "incident_events_incident_id_created_at_idx" ON "incident_events"("incident_id", "created_at");

-- CreateIndex
CREATE INDEX "bot_sessions_expires_at_idx" ON "bot_sessions"("expires_at");

-- CreateIndex
CREATE INDEX "outbox_messages_status_next_attempt_at_idx" ON "outbox_messages"("status", "next_attempt_at");

-- AddForeignKey
ALTER TABLE "apartments" ADD CONSTRAINT "apartments_building_id_fkey" FOREIGN KEY ("building_id") REFERENCES "buildings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resident_memberships" ADD CONSTRAINT "resident_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resident_memberships" ADD CONSTRAINT "resident_memberships_apartment_id_fkey" FOREIGN KEY ("apartment_id") REFERENCES "apartments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_building_id_fkey" FOREIGN KEY ("building_id") REFERENCES "buildings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_assignee_admin_id_fkey" FOREIGN KEY ("assignee_admin_id") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "incidents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_apartment_id_fkey" FOREIGN KEY ("apartment_id") REFERENCES "apartments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incident_subscriptions" ADD CONSTRAINT "incident_subscriptions_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "incidents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incident_subscriptions" ADD CONSTRAINT "incident_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incident_events" ADD CONSTRAINT "incident_events_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "incidents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incident_events" ADD CONSTRAINT "incident_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incident_events" ADD CONSTRAINT "incident_events_actor_admin_id_fkey" FOREIGN KEY ("actor_admin_id") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bot_sessions" ADD CONSTRAINT "bot_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbox_messages" ADD CONSTRAINT "outbox_messages_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "incidents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
