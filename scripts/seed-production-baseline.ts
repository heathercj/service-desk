import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { ROLE_NAMES, DEPARTMENTS, FRANCHISES } from "../src/lib/reference-data";

/**
 * Production-safe baseline seed: the Role, Department, and Franchise rows
 * every environment needs before the app can create a ticket or grant a
 * role at all -- unlike `prisma/seed.ts`, this seeds ONLY that baseline
 * (no dev identities, no demo tickets/articles) and does not refuse to run
 * in NODE_ENV=production. Safe to re-run (upserts throughout).
 *
 *   pnpm db:seed:baseline
 *
 * Run this once against a fresh production database, before
 * `pnpm bootstrap:admin` (which needs the ADMINISTRATOR role row to exist).
 */
const db = new PrismaClient();

async function main() {
  for (const name of ROLE_NAMES) {
    await db.role.upsert({ where: { name }, create: { name }, update: {} });
  }
  for (const d of DEPARTMENTS) {
    await db.department.upsert({ where: { key: d.key }, create: d, update: {} });
  }
  for (const f of FRANCHISES) {
    await db.franchise.upsert({ where: { code: f.code }, create: f, update: {} });
  }
  console.log(
    `Seeded ${ROLE_NAMES.length} roles, ${DEPARTMENTS.length} departments, ` +
      `${FRANCHISES.length} franchises.`,
  );
}

main()
  .catch((err) => {
    console.error("db:seed:baseline failed:", err);
    process.exit(1);
  })
  .finally(() => void db.$disconnect());
