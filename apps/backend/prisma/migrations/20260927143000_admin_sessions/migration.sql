CREATE TABLE "admin_sessions" (
    "id" UUID NOT NULL,
    "admin_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "admin_sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "admin_sessions_token_hash_key" ON "admin_sessions"("token_hash");
CREATE INDEX "admin_sessions_expires_at_idx" ON "admin_sessions"("expires_at");

ALTER TABLE "admin_sessions"
ADD CONSTRAINT "admin_sessions_admin_id_fkey"
FOREIGN KEY ("admin_id") REFERENCES "admins"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
