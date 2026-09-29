ALTER TABLE "buildings" ADD COLUMN "chat_link" TEXT;

CREATE TABLE "incident_comments" (
  "id" UUID NOT NULL,
  "incident_id" UUID NOT NULL,
  "author_user_id" UUID NOT NULL,
  "text" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "incident_comments_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "incident_comments"
  ADD CONSTRAINT "incident_comments_incident_id_fkey"
  FOREIGN KEY ("incident_id") REFERENCES "incidents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "incident_comments"
  ADD CONSTRAINT "incident_comments_author_user_id_fkey"
  FOREIGN KEY ("author_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "incident_comments_incident_id_created_at_idx" ON "incident_comments"("incident_id", "created_at");
