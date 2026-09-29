CREATE TABLE "admin_audit_events" (
    "id" UUID NOT NULL,
    "admin_id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "admin_audit_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "admin_audit_events_admin_id_created_at_idx"
    ON "admin_audit_events"("admin_id", "created_at");
CREATE INDEX "admin_audit_events_entity_type_entity_id_idx"
    ON "admin_audit_events"("entity_type", "entity_id");
ALTER TABLE "admin_audit_events"
    ADD CONSTRAINT "admin_audit_events_admin_id_fkey"
    FOREIGN KEY ("admin_id") REFERENCES "admins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
