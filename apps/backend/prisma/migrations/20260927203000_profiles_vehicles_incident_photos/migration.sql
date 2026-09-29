CREATE TABLE "resident_profiles" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "residents_count" INTEGER,
  "phone" TEXT,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "resident_profiles_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "resident_profiles_user_id_key" UNIQUE ("user_id"),
  CONSTRAINT "resident_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
);

CREATE TABLE "vehicles" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "license_plate" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "vehicles_license_plate_key" UNIQUE ("license_plate"),
  CONSTRAINT "vehicles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
);
CREATE INDEX "vehicles_user_id_idx" ON "vehicles"("user_id");

CREATE TABLE "incident_photos" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "incident_id" UUID NOT NULL,
  "author_user_id" UUID NOT NULL,
  "max_token" TEXT NOT NULL,
  "max_url" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "incident_photos_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "incident_photos_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "incidents"("id") ON DELETE RESTRICT,
  CONSTRAINT "incident_photos_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "users"("id") ON DELETE RESTRICT
);
CREATE INDEX "incident_photos_incident_id_created_at_idx" ON "incident_photos"("incident_id", "created_at");
CREATE INDEX "incident_photos_author_user_id_incident_id_idx" ON "incident_photos"("author_user_id", "incident_id");
