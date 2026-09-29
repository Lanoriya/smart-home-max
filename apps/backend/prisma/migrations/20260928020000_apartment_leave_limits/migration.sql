CREATE TABLE "apartment_leaves" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "apartment_leaves_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "apartment_leaves"
  ADD CONSTRAINT "apartment_leaves_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "apartment_leaves_user_id_created_at_idx" ON "apartment_leaves"("user_id", "created_at");
