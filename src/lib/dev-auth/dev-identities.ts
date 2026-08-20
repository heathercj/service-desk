import type { RoleName } from "@prisma/client";

/**
 * Seeded development-only identities (Section 3). These are the ONLY
 * accounts the dev-auth Credentials provider will ever accept. They are
 * created exclusively by `prisma/seed.ts` -- signing in never creates a new
 * dev account, so ENABLE_DEV_AUTH can never conjure an arbitrary identity.
 *
 * entraObjectId values are fixed, obviously-fake GUIDs (not real Entra
 * data) so they can never collide with a real tenant's object IDs.
 */
export interface DevIdentity {
  key: string;
  entraObjectId: string;
  displayName: string;
  email: string;
  roles: RoleName[];
  departmentKeys?: Array<
    "TECHNOLOGY_SUPPORT" | "TRAINING" | "ACCOUNTING_SERVICES" | "MARKETING" | "LEGAL"
  >;
  managerOf?: Array<
    "TECHNOLOGY_SUPPORT" | "TRAINING" | "ACCOUNTING_SERVICES" | "MARKETING" | "LEGAL"
  >;
  description: string;
}

export const DEV_IDENTITIES: DevIdentity[] = [
  {
    key: "customer",
    entraObjectId: "00000000-dev0-0000-0000-000000000001",
    displayName: "Casey Customer",
    email: "casey.customer@dev.example.test",
    roles: ["CUSTOMER"],
    description: "Franchise partner submitting and tracking their own tickets.",
  },
  {
    key: "customer2",
    entraObjectId: "00000000-dev0-0000-0000-000000000007",
    displayName: "Jordan Second-Customer",
    email: "jordan.second@dev.example.test",
    roles: ["CUSTOMER"],
    description:
      "A second customer identity, used to verify one customer cannot access another's tickets.",
  },
  {
    key: "triage",
    entraObjectId: "00000000-dev0-0000-0000-000000000002",
    displayName: "Taylor Triage",
    email: "taylor.triage@dev.example.test",
    roles: ["TRIAGE_AGENT"],
    description: "Reviews the submitted-ticket queue and routes to departments.",
  },
  {
    key: "dept-agent",
    entraObjectId: "00000000-dev0-0000-0000-000000000003",
    displayName: "Alex Agent",
    email: "alex.agent@dev.example.test",
    roles: ["DEPARTMENT_AGENT"],
    departmentKeys: ["TECHNOLOGY_SUPPORT"],
    description: "Technology Support agent working assigned tickets.",
  },
  {
    key: "dept-manager",
    entraObjectId: "00000000-dev0-0000-0000-000000000004",
    displayName: "Morgan Manager",
    email: "morgan.manager@dev.example.test",
    roles: ["DEPARTMENT_MANAGER", "DEPARTMENT_AGENT"],
    departmentKeys: ["TECHNOLOGY_SUPPORT", "TRAINING"],
    managerOf: ["TECHNOLOGY_SUPPORT", "TRAINING"],
    description: "Manages Technology Support and Training queues/workload.",
  },
  {
    key: "accounting-agent",
    entraObjectId: "00000000-dev0-0000-0000-000000000008",
    displayName: "Priya Accounting-Agent",
    email: "priya.accounting@dev.example.test",
    roles: ["DEPARTMENT_AGENT"],
    departmentKeys: ["ACCOUNTING_SERVICES"],
    description: "Accounting Services agent, for department-scoping demos.",
  },
  {
    key: "knowledge-manager",
    entraObjectId: "00000000-dev0-0000-0000-000000000005",
    displayName: "Kai Knowledge",
    email: "kai.knowledge@dev.example.test",
    roles: ["KNOWLEDGE_MANAGER"],
    description: "Reviews, publishes, and archives knowledge articles.",
  },
  {
    key: "admin",
    entraObjectId: "00000000-dev0-0000-0000-000000000006",
    displayName: "Robin Admin",
    email: "robin.admin@dev.example.test",
    roles: ["ADMINISTRATOR"],
    description: "Manages users, roles, departments, and application settings.",
  },
];

export function findDevIdentity(key: string): DevIdentity | undefined {
  return DEV_IDENTITIES.find((identity) => identity.key === key);
}
