-- Announcements the company put away into its archive: residents no longer see them.
ALTER TABLE "announcements" ADD COLUMN "archived_at" TIMESTAMPTZ(3);
