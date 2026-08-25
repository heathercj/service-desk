import "dotenv/config";
import { bootstrapFirstAdministrator } from "../src/lib/admin/bootstrap-admin";

/**
 * One-time production step: grants ADMINISTRATOR to a real user by email,
 * so a fresh deployment has a way into /admin/users at all. Requires that
 * person to have already signed in for real at least once (their User row
 * is created automatically on sign-in) and that no Administrator already
 * exists (see src/lib/admin/bootstrap-admin.ts for both guards).
 *
 *   pnpm bootstrap:admin -- someone@alairhomes.com
 */
async function main() {
  const email = process.argv[2];
  if (!email) {
    console.error("Usage: pnpm bootstrap:admin -- someone@alairhomes.com");
    process.exit(1);
  }

  const result = await bootstrapFirstAdministrator(email);
  console.log(
    `Granted ADMINISTRATOR to ${result.displayName} (${result.email}). ` +
      `They can now use /admin/users to grant roles to everyone else.`,
  );
}

main().catch((err) => {
  console.error("bootstrap:admin failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
