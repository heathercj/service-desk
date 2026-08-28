import type { RoleName } from "@prisma/client";

/**
 * The baseline reference rows every environment needs -- roles,
 * departments, and franchises -- shared so this list is maintained in
 * exactly one place. `prisma/seed.ts` (dev/demo, refuses to run in
 * production) and `scripts/seed-production-baseline.ts` (production-safe,
 * baseline rows only) both seed from this same data, as does
 * `src/test-support/fixtures.ts` for integration tests. Before this
 * existed, adding a department meant editing three separate hardcoded
 * copies of this list and hoping none drifted.
 */

export const ROLE_NAMES: RoleName[] = [
  "CUSTOMER",
  "TRIAGE_AGENT",
  "DEPARTMENT_AGENT",
  "DEPARTMENT_MANAGER",
  "KNOWLEDGE_MANAGER",
  "ADMINISTRATOR",
];

export const DEPARTMENTS: Array<{ key: string; name: string }> = [
  { key: "TECHNOLOGY_SUPPORT", name: "Technology Support" },
  { key: "TRAINING", name: "Training" },
  { key: "ACCOUNTING_SERVICES", name: "Accounting Services" },
  { key: "MARKETING", name: "Marketing" },
  { key: "LEGAL", name: "Legal" },
  { key: "IMPROVEMENT_IDEAS", name: "Improvement Ideas" },
];

export const FRANCHISES: Array<{ code: string; name: string }> = [
  { code: "VAN", name: "Alair Homes Vancouver" },
  { code: "CAL", name: "Alair Homes Calgary" },
  { code: "TOR", name: "Alair Homes Toronto" },
  // Fallback for ticket intake (web and email) when the submitter's Entra
  // department value doesn't match a real franchise -- see
  // src/lib/tickets/franchise-lookup.ts. Triage can correct it afterward.
  { code: "HQ", name: "Head Office / Unassigned" },
];
