-- Least privilege for the Admin.role default.
--
-- The column was added with DEFAULT 'OWNER', so any code path that created an
-- admin without naming a role produced an OWNER. New rows without an explicit
-- role are now READONLY. Existing rows are NOT touched: this changes the
-- default only.
ALTER TABLE "Admin" ALTER COLUMN "role" SET DEFAULT 'READONLY';
