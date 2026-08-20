import { readFileSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";

/**
 * Applies scripts/db-search-setup.sql (idempotent) against DATABASE_URL.
 * Runs after every `prisma migrate dev|deploy` (Section 11) since Prisma's
 * migration DSL doesn't manage tsvector generated columns/triggers.
 */
async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set");
  }

  const sqlPath = path.join(__dirname, "db-search-setup.sql");
  const sql = readFileSync(sqlPath, "utf8");

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(sql);
    console.log(
      "Knowledge-base search setup applied (pg_trgm + tsvector triggers/indexes).",
    );
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("db:search:setup failed:", err);
  process.exit(1);
});
