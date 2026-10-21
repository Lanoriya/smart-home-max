-- The current interactive bot message of each resident, so button presses can
-- edit it instead of adding a new message to the chat.
ALTER TABLE "users" ADD COLUMN "screen_message_id" TEXT;
ALTER TABLE "users" ADD COLUMN "screen_has_media" BOOLEAN NOT NULL DEFAULT false;
