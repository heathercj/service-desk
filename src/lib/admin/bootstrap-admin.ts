import "server-only";
import { db } from "@/lib/db";
import { ForbiddenError, NotFoundError } from "@/lib/rbac/errors";

/**
 * One-time production bootstrap: grants ADMINISTRATOR to a real user by
 * email, so a fresh deployment has a way in at all -- `/admin/users`
 * itself requires an existing Administrator to reach, and nothing else in
 * the app can grant the first one. Run via `pnpm bootstrap:admin`
 * (scripts/bootstrap-admin.ts) after that person has signed in for real at
 * least once (their User row is created automatically on first sign-in --
 * see the `jwt` callback in src/auth.ts -- this never creates one itself).
 *
 * Two guards keep this from becoming a standing backdoor rather than a
 * one-time bootstrap step:
 *  - refuses once ANY Administrator already exists, so it's usable exactly
 *    once per deployment;
 *  - the target user must already exist from a real sign-in -- this never
 *    conjures an account.
 */
export async function bootstrapFirstAdministrator(email: string) {
  const existingAdminCount = await db.userRole.count({
    where: { role: { name: "ADMINISTRATOR" } },
  });
  if (existingAdminCount > 0) {
    throw new ForbiddenError(
      "Refusing: an Administrator already exists. Use /admin/users to grant roles instead.",
    );
  }

  const user = await db.user.findFirst({ where: { email } });
  if (!user) {
    throw new NotFoundError(
      `No user found for "${email}" -- they must sign in for real at least once first.`,
    );
  }

  const role = await db.role.findUnique({ where: { name: "ADMINISTRATOR" } });
  if (!role) {
    throw new NotFoundError(
      'No "ADMINISTRATOR" role row exists -- run the baseline seed first (pnpm db:seed:baseline).',
    );
  }

  await db.userRole.create({ data: { userId: user.id, roleId: role.id } });
  return { userId: user.id, email: user.email, displayName: user.displayName };
}
