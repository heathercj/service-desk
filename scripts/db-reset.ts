import { execSync } from "node:child_process";

/**
 * Safely resets local prototype data (Section 19, 21). Refuses to run
 * against a production environment -- this is destructive (drops and
 * recreates the schema) and must never be reachable outside local/dev use.
 */
function main() {
  if (process.env.NODE_ENV === "production") {
    console.error("Refusing to reset the database: NODE_ENV=production.");
    process.exit(1);
  }

  const databaseUrl = process.env.DATABASE_URL ?? "";
  if (
    !databaseUrl.includes("localhost") &&
    !databaseUrl.includes("127.0.0.1") &&
    !databaseUrl.includes("postgres:5432")
  ) {
    console.error(
      "Refusing to reset the database: DATABASE_URL does not look like a local development database.\n" +
        `  DATABASE_URL="${databaseUrl}"`,
    );
    process.exit(1);
  }

  console.log("Resetting local database (migrate reset + seed)...");
  execSync("pnpm exec prisma migrate reset --force --skip-generate", {
    stdio: "inherit",
  });
  execSync("pnpm db:search:setup", { stdio: "inherit" });
  console.log("Database reset complete.");
}

main();
