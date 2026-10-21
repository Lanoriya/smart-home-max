-- Head of a management company and dispatcher become one role: everyone who
-- works for a company gets the same rights in the desk.
UPDATE "admins" SET "role" = 'supervisor' WHERE "role" = 'dispatcher';
UPDATE "admin_invites" SET "role" = 'supervisor' WHERE "role" = 'dispatcher';
ALTER TABLE "admins" ALTER COLUMN "role" SET DEFAULT 'supervisor';
