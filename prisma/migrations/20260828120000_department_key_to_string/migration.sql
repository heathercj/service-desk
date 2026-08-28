-- Widen Department.key from the fixed DepartmentKey enum to plain text, so
-- departments can be created/renamed by administrators at runtime instead
-- of requiring a migration per department. Hand-written rather than
-- Prisma's auto-generated diff: the naive diff drops and recreates the
-- column (data loss for the six existing rows). This preserves the
-- existing values via an explicit cast.

-- AlterTable
ALTER TABLE "Department" ALTER COLUMN "key" TYPE TEXT USING "key"::TEXT;

-- DropEnum
DROP TYPE "DepartmentKey";
