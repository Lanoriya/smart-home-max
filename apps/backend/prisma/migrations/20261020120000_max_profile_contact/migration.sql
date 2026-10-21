-- Nick from the MAX profile and a phone the resident chose to share with the
-- bot. Shown to the residents of the same apartment and to the dispatcher.
ALTER TABLE "users" ADD COLUMN "max_username" TEXT;
ALTER TABLE "users" ADD COLUMN "shared_phone" TEXT;
ALTER TABLE "users" ADD COLUMN "phone_shared_at" TIMESTAMPTZ(3);
