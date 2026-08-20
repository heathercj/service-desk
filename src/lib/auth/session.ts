import "server-only";
import { cache } from "react";
import type { RoleName } from "@prisma/client";
import { auth } from "@/auth";
import { db } from "@/lib/db";

export interface AuthContext {
  userId: string;
  displayName: string;
  email: string;
  entraObjectId: string;
  entraTenantId: string;
  isDevAccount: boolean;
  roles: Set<RoleName>;
  /** departmentId -> isManager */
  departments: Map<string, boolean>;
}

/**
 * Resolves the authenticated identity AND its current roles/department
 * memberships directly from the database on every call.
 *
 * Section 3 is explicit that roles, department IDs, and ownership must
 * never be trusted from the browser -- that includes not trusting a JWT
 * claim either, since a role grant/revoke must take effect immediately, not
 * at next login. `cache()` only de-duplicates repeated calls within a
 * single request's render pass; it never crosses requests.
 */
export const getAuthContext = cache(async (): Promise<AuthContext | null> => {
  const session = await auth();
  if (!session?.user?.id) return null;

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    include: {
      roles: { include: { role: true } },
      departmentMemberships: true,
    },
  });

  if (!user || !user.isActive) return null;

  // Defence in depth: re-verify the tenant claim stored on the user row
  // still matches the configured tenant (guards against a stale row from a
  // reconfigured ENTRA_TENANT_ID being reused).
  if (user.entraTenantId !== session.user.entraTenantId) return null;

  return {
    userId: user.id,
    displayName: user.displayName,
    email: user.email,
    entraObjectId: user.entraObjectId,
    entraTenantId: user.entraTenantId,
    isDevAccount: user.isDevAccount,
    roles: new Set(user.roles.map((r) => r.role.name)),
    departments: new Map(
      user.departmentMemberships.map((m) => [m.departmentId, m.isManager]),
    ),
  };
});

export async function requireAuthContext(): Promise<AuthContext> {
  const ctx = await getAuthContext();
  if (!ctx) {
    throw new Error("UNAUTHENTICATED");
  }
  return ctx;
}
