import type { RoleName } from "@prisma/client";
import { departmentKeyToFolder } from "@/lib/knowledge/department-folders";

/**
 * Local, deterministic staff personas for the simulation harness
 * (scripts/sim-run.ts). Each persona extends the kind of one-line
 * description already used for dev-auth identities
 * (src/lib/dev-auth/dev-identities.ts) with an industry-standard skill set
 * for its role/department, so simulated diagnostic notes and replies read
 * like something that role would actually write. No LLM/network call is
 * involved anywhere -- see docs/adr/0003-local-ai-provider-no-external-api.md.
 */
export interface AgentPersona {
  key: string;
  roleName: RoleName;
  departmentKey?: string;
  isManager?: boolean;
  displayName: string;
  email: string;
  description: string;
  skills: string[];
}

export const TRIAGE_PERSONA: AgentPersona = {
  key: "sim-triage",
  roleName: "TRIAGE_AGENT",
  displayName: "Sim Triage Agent",
  email: "sim.triage@sim.example.test",
  description:
    "Reviews the submitted-ticket queue and routes tickets to the right department.",
  skills: [
    "ITIL-aligned incident logging and categorization",
    "SLA-based prioritization",
    "active listening and needs clarification",
    "keyword-based routing judgment",
    "escalation awareness",
  ],
};

interface DepartmentSkillSet {
  departmentKey: string;
  departmentName: string;
  agentSkills: string[];
  managerSkillAdditions: string[];
}

const DEPARTMENT_SKILL_SETS: DepartmentSkillSet[] = [
  {
    departmentKey: "TECHNOLOGY_SUPPORT",
    departmentName: "Technology Support",
    agentSkills: [
      "Tier 1/2 troubleshooting",
      "Windows/M365 and Active Directory administration",
      "network, VPN, and Wi-Fi diagnostics",
      "endpoint security basics",
      "hardware (laptop/printer) support",
      "ITIL incident and problem management",
    ],
    managerSkillAdditions: [
      "queue and workload management",
      "SLA and KPI oversight",
      "escalation authority",
      "staff coaching and quality review",
      "vendor/hardware procurement liaison",
    ],
  },
  {
    departmentKey: "TRAINING",
    departmentName: "Training",
    agentSkills: [
      "instructional design (ADDIE model)",
      "LMS administration",
      "onboarding program facilitation",
      "adult-learning principles",
      "certification and compliance tracking",
    ],
    managerSkillAdditions: [
      "curriculum strategy and budget ownership",
      "cross-department training needs analysis",
      "trainer performance review",
      "escalation authority",
    ],
  },
  {
    departmentKey: "ACCOUNTING_SERVICES",
    departmentName: "Accounting Services",
    agentSkills: [
      "accounts payable/receivable processing",
      "payroll administration",
      "expense and budget reconciliation",
      "GAAP-aligned bookkeeping",
      "franchise billing and invoicing compliance",
    ],
    managerSkillAdditions: [
      "financial controls and audit oversight",
      "budget approval authority",
      "month-end close management",
      "escalation authority",
    ],
  },
  {
    departmentKey: "MARKETING",
    departmentName: "Marketing",
    agentSkills: [
      "brand-guideline stewardship",
      "campaign coordination",
      "digital and social media management",
      "signage and print production coordination",
      "content and copy review",
    ],
    managerSkillAdditions: [
      "marketing strategy and spend approval",
      "brand governance across franchises",
      "vendor/agency management",
      "escalation authority",
    ],
  },
  {
    departmentKey: "LEGAL",
    departmentName: "Legal",
    agentSkills: [
      "contract review and redlining",
      "compliance and regulatory tracking",
      "dispute and liability triage",
      "trademark and licensing administration",
      "NDA processing",
    ],
    managerSkillAdditions: [
      "risk management and escalation authority",
      "outside-counsel liaison",
      "policy/compliance program ownership",
    ],
  },
];

export const DEPARTMENT_AGENT_PERSONAS: AgentPersona[] = DEPARTMENT_SKILL_SETS.map(
  (d) => ({
    key: `sim-agent-${departmentKeyToFolder(d.departmentKey)}`,
    roleName: "DEPARTMENT_AGENT",
    departmentKey: d.departmentKey,
    isManager: false,
    displayName: `Sim ${d.departmentName} Agent`,
    email: `sim.agent.${departmentKeyToFolder(d.departmentKey)}@sim.example.test`,
    description: `${d.departmentName} agent working assigned tickets.`,
    skills: d.agentSkills,
  }),
);

export const DEPARTMENT_MANAGER_PERSONAS: AgentPersona[] = DEPARTMENT_SKILL_SETS.map(
  (d) => ({
    key: `sim-manager-${departmentKeyToFolder(d.departmentKey)}`,
    roleName: "DEPARTMENT_MANAGER",
    departmentKey: d.departmentKey,
    isManager: true,
    displayName: `Sim ${d.departmentName} Manager`,
    email: `sim.manager.${departmentKeyToFolder(d.departmentKey)}@sim.example.test`,
    description: `Manages the ${d.departmentName} queue and workload.`,
    skills: [...d.agentSkills, ...d.managerSkillAdditions],
  }),
);

export const ALL_AGENT_PERSONAS: AgentPersona[] = [
  TRIAGE_PERSONA,
  ...DEPARTMENT_AGENT_PERSONAS,
  ...DEPARTMENT_MANAGER_PERSONAS,
];

export function findDepartmentAgentPersona(departmentKey: string): AgentPersona {
  const persona = DEPARTMENT_AGENT_PERSONAS.find(
    (p) => p.departmentKey === departmentKey,
  );
  if (!persona) throw new Error(`No department agent persona for ${departmentKey}`);
  return persona;
}

export function findDepartmentManagerPersona(departmentKey: string): AgentPersona {
  const persona = DEPARTMENT_MANAGER_PERSONAS.find(
    (p) => p.departmentKey === departmentKey,
  );
  if (!persona) throw new Error(`No department manager persona for ${departmentKey}`);
  return persona;
}
