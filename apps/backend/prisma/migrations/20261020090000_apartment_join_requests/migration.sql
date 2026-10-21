-- Joining an apartment that already has connected residents needs their
-- approval (or a dispatcher's), so a stranger with the building code cannot
-- attach himself to any apartment.
CREATE TYPE "JoinRequestStatus" AS ENUM ('pending', 'approved', 'rejected', 'cancelled');

CREATE TABLE "apartment_join_requests" (
  "id" UUID NOT NULL,
  "apartment_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "status" "JoinRequestStatus" NOT NULL DEFAULT 'pending',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "decided_at" TIMESTAMPTZ(3),
  "decided_by_user_id" UUID,
  "decided_by_admin_id" UUID,
  CONSTRAINT "apartment_join_requests_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "apartment_join_requests_apartment_id_status_idx" ON "apartment_join_requests"("apartment_id", "status");
CREATE INDEX "apartment_join_requests_user_id_status_idx" ON "apartment_join_requests"("user_id", "status");
ALTER TABLE "apartment_join_requests" ADD CONSTRAINT "apartment_join_requests_apartment_id_fkey" FOREIGN KEY ("apartment_id") REFERENCES "apartments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "apartment_join_requests" ADD CONSTRAINT "apartment_join_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "apartment_join_requests" ADD CONSTRAINT "apartment_join_requests_decided_by_user_id_fkey" FOREIGN KEY ("decided_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "apartment_join_requests" ADD CONSTRAINT "apartment_join_requests_decided_by_admin_id_fkey" FOREIGN KEY ("decided_by_admin_id") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- At most one open request per resident.
CREATE UNIQUE INDEX "apartment_join_requests_one_pending_per_user" ON "apartment_join_requests"("user_id") WHERE "status" = 'pending';
