import "server-only";
import { db } from "@/lib/db";
import { NotFoundError } from "@/lib/rbac/errors";
import { graphFetch } from "@/lib/graph/client";

/**
 * Franchise is derived from the submitter's Entra `department` attribute
 * rather than picked by hand (Section: ticket intake) -- every franchise
 * employee's directory profile carries it, so this is the single source of
 * truth for both the web ticket form and email intake.
 */

/** The franchise every ticket falls back to when Entra has no usable
 * department value for the submitter, or the lookup itself fails. Triage
 * can correct it afterward via confirmTriage()'s franchiseId override. */
export const FALLBACK_FRANCHISE_CODE = "HQ";

export interface EntraUserProfile {
  id: string;
  displayName: string;
  mail: string | null;
  department: string | null;
}

/**
 * Looks up a user's Entra directory profile by email (app-only Graph,
 * User.Read.All) -- id/displayName/mail for identity provisioning
 * (email-intake-service.ts), department for franchise resolution. One
 * call serves both, since email intake needs both for the same sender.
 * Never throws -- a directory hiccup must not block ticket submission.
 */
export async function lookupEntraUser(email: string): Promise<EntraUserProfile | null> {
  try {
    const res = await graphFetch(
      `/users/${encodeURIComponent(email)}?$select=id,displayName,mail,department`,
    );
    if (!res.ok) return null;
    return (await res.json()) as EntraUserProfile;
  } catch {
    return null;
  }
}

/** Just the department, for callers (createTicket()) that only need that. */
export async function lookupEntraDepartment(email: string): Promise<string | null> {
  const profile = await lookupEntraUser(email);
  return profile?.department?.trim() || null;
}

/**
 * Pure matching rule, kept separate from the DB/Graph calls so it's cheap
 * to unit test: does this Entra department value identify one of these
 * franchises, by name or by code, case-insensitively?
 */
export function matchFranchiseForDepartment(
  departmentValue: string | null | undefined,
  franchises: ReadonlyArray<{ id: string; name: string; code: string }>,
): string | null {
  const needle = departmentValue?.trim().toLowerCase();
  if (!needle) return null;
  const match = franchises.find(
    (f) => f.name.toLowerCase() === needle || f.code.toLowerCase() === needle,
  );
  return match?.id ?? null;
}

/**
 * Resolves the franchise a ticket should be created under, given an Entra
 * department value (or null/failed lookup). Falls back to the designated
 * FALLBACK_FRANCHISE_CODE franchise rather than throwing, so a Graph
 * hiccup or an employee with no department set never blocks submission --
 * see docs/TICKET_LIFECYCLE.md-style "reviewed by Triage" pattern already
 * used for department suggestion.
 */
export async function resolveFranchiseForDepartment(
  departmentValue: string | null,
): Promise<{ id: string }> {
  const franchises = await db.franchise.findMany({
    where: { isActive: true },
    select: { id: true, name: true, code: true },
  });

  const matchedId = matchFranchiseForDepartment(departmentValue, franchises);
  if (matchedId) return { id: matchedId };

  const fallback = franchises.find((f) => f.code === FALLBACK_FRANCHISE_CODE);
  if (fallback) return { id: fallback.id };

  throw new NotFoundError(
    `No active franchise available, and the fallback franchise "${FALLBACK_FRANCHISE_CODE}" is not seeded`,
  );
}
