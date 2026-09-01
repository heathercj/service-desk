/**
 * Actor fixtures -- ready-made `AuthContext` values, one per role.
 *
 * `AuthContext` is what every service and route helper takes as its first
 * argument, and it is the ONLY place roles and department membership come
 * from (see src/lib/auth/session.ts: never trusted from the browser). So a
 * test's whole authorisation story is expressed by which actor it passes,
 * which keeps scenarios readable: `whenAgentResolves(itAgent, ...)`.
 */
import type { RoleName } from "@prisma/client";
import type { AuthContext } from "@/lib/auth/session";

/** Stable department ids so fixtures and assertions can refer to them by name. */
export const DEPARTMENTS = {
  it: "11111111-0000-4000-8000-000000000001",
  facilities: "11111111-0000-4000-8000-000000000002",
  hr: "11111111-0000-4000-8000-000000000003",
} as const;

export const TEST_TENANT_ID = "11111111-1111-1111-1111-111111111111";

export interface ActorOverrides {
  userId?: string;
  displayName?: string;
  email?: string;
  roles?: RoleName[];
  /** departmentId -> isManager */
  departments?: Record<string, boolean>;
  entraTenantId?: string;
  isDevAccount?: boolean;
}

let actorSeq = 0;

/**
 * Builds an `AuthContext`. Prefer the named actors below; reach for this
 * directly only when a scenario needs an unusual combination (e.g. an agent
 * who belongs to two departments, or a cross-tenant identity).
 */
export function makeActor(overrides: ActorOverrides = {}): AuthContext {
  actorSeq += 1;
  const seq = String(actorSeq).padStart(4, "0");
  const roles = overrides.roles ?? ["CUSTOMER"];
  return {
    userId: overrides.userId ?? `00000000-0000-4000-8000-00000000${seq}`,
    displayName: overrides.displayName ?? `Test ${roles[0]} ${seq}`,
    email: overrides.email ?? `test-${seq}@example.com`,
    entraObjectId: `99999999-0000-4000-8000-00000000${seq}`,
    entraTenantId: overrides.entraTenantId ?? TEST_TENANT_ID,
    isDevAccount: overrides.isDevAccount ?? false,
    roles: new Set(roles),
    departments: new Map(Object.entries(overrides.departments ?? {})),
  };
}

export const actors = {
  customer: (o: ActorOverrides = {}) => makeActor({ roles: ["CUSTOMER"], ...o }),

  triageAgent: (o: ActorOverrides = {}) => makeActor({ roles: ["TRIAGE_AGENT"], ...o }),

  /** Department agent -- defaults to a member (not manager) of IT. */
  departmentAgent: (o: ActorOverrides = {}) =>
    makeActor({
      roles: ["DEPARTMENT_AGENT"],
      departments: { [DEPARTMENTS.it]: false },
      ...o,
    }),

  departmentManager: (o: ActorOverrides = {}) =>
    makeActor({
      roles: ["DEPARTMENT_MANAGER"],
      departments: { [DEPARTMENTS.it]: true },
      ...o,
    }),

  knowledgeManager: (o: ActorOverrides = {}) =>
    makeActor({ roles: ["KNOWLEDGE_MANAGER"], ...o }),

  productManager: (o: ActorOverrides = {}) =>
    makeActor({ roles: ["PRODUCT_MANAGER"], ...o }),

  administrator: (o: ActorOverrides = {}) =>
    makeActor({ roles: ["ADMINISTRATOR"], ...o }),
} as const;

/** Every role, for scenario outlines that sweep the whole matrix. */
export const ALL_ROLES: readonly RoleName[] = [
  "CUSTOMER",
  "TRIAGE_AGENT",
  "DEPARTMENT_AGENT",
  "DEPARTMENT_MANAGER",
  "KNOWLEDGE_MANAGER",
  "PRODUCT_MANAGER",
  "ADMINISTRATOR",
];
