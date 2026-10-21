-- Failed sign-ins of the web desk, by address.
CREATE TABLE "admin_login_failures" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "first_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "blocked_until" TIMESTAMPTZ(3),
    CONSTRAINT "admin_login_failures_pkey" PRIMARY KEY ("key")
);

CREATE INDEX "admin_login_failures_first_at_idx" ON "admin_login_failures"("first_at");
