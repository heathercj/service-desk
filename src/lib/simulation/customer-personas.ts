import type { DepartmentKey, TicketPriority } from "@prisma/client";

/**
 * Local, deterministic "customer" personas for the simulation harness
 * (scripts/sim-run.ts): franchise-realistic submitter archetypes used to
 * emulate feedback through the ticket lifecycle. `skills` here describes
 * communication style/technical literacy, not job skills -- these are
 * ticket submitters, not staff.
 */
export interface TicketScenario {
  subject: string;
  description: string;
  departmentKey: DepartmentKey;
  category: string;
  priority: TicketPriority;
}

export interface CustomerBehavior {
  /** Probability [0,1] the customer accepts the first resolution as-is. */
  patience: number;
  /** Probability [0,1] a dissatisfied customer escalates/reopens rather than just asking a follow-up. */
  escalationThreshold: number;
}

export interface CustomerPersona {
  key: string;
  displayName: string;
  email: string;
  description: string;
  skills: string[];
  commonDepartments: DepartmentKey[];
  scenarios: TicketScenario[];
  behavior: CustomerBehavior;
}

export const CUSTOMER_PERSONAS: CustomerPersona[] = [
  {
    key: "sim-customer-business-owner",
    displayName: "Sim Customer - Business Owner",
    email: "sim.customer.business-owner@sim.example.test",
    description: "Franchise owner focused on the business's bottom line and brand risk.",
    skills: [
      "big-picture prioritization",
      "directive, concise communication",
      "financial literacy",
      "low tolerance for delay -- escalates quickly",
    ],
    commonDepartments: ["LEGAL", "ACCOUNTING_SERVICES", "MARKETING"],
    scenarios: [
      {
        subject: "Need review of new subcontractor agreement",
        description:
          "We're bringing on a new subcontractor for the Riverside project and I need someone in Legal to review the trade contract and confirm the liability and indemnity clauses before we sign. Can this get priority attention this week?",
        departmentKey: "LEGAL",
        category: "Contract Review",
        priority: "HIGH",
      },
      {
        subject: "Question about this month's franchise royalty invoice",
        description:
          "The royalty invoice for this billing cycle looks higher than expected and I need accounting to walk me through the calculation before I approve payment.",
        departmentKey: "ACCOUNTING_SERVICES",
        category: "Billing Inquiry",
        priority: "MEDIUM",
      },
    ],
    behavior: { patience: 0.4, escalationThreshold: 0.6 },
  },
  {
    key: "sim-customer-project-manager",
    displayName: "Sim Customer - Project Manager",
    email: "sim.customer.project-manager@sim.example.test",
    description: "Coordinates multiple active job sites and the crews assigned to them.",
    skills: [
      "multi-project coordination",
      "moderate technical literacy",
      "detail-oriented, process-driven follow-up",
    ],
    commonDepartments: ["TECHNOLOGY_SUPPORT", "TRAINING", "ACCOUNTING_SERVICES"],
    scenarios: [
      {
        subject: "Scheduling software won't sync across job sites",
        description:
          "The scheduling software isn't syncing between my laptop and the site office computer, so my crew schedule is out of date across two active builds. This is blocking coordination for tomorrow's inspections.",
        departmentKey: "TECHNOLOGY_SUPPORT",
        category: "Software Sync",
        priority: "HIGH",
      },
      {
        subject: "Need onboarding course access for two new site supervisors",
        description:
          "I just hired two site supervisors and need them enrolled in the onboarding certification course before they start next week.",
        departmentKey: "TRAINING",
        category: "Onboarding",
        priority: "MEDIUM",
      },
    ],
    behavior: { patience: 0.6, escalationThreshold: 0.35 },
  },
  {
    key: "sim-customer-head-office-staff",
    displayName: "Sim Customer - Head Office Staff",
    email: "sim.customer.head-office-staff@sim.example.test",
    description: "Day-to-day head office administrative staff.",
    skills: ["moderate-to-high software literacy", "polite, formal tone", "patient, methodical follow-up"],
    commonDepartments: ["TECHNOLOGY_SUPPORT", "MARKETING", "ACCOUNTING_SERVICES"],
    scenarios: [
      {
        subject: "Outlook keeps crashing when opening shared calendar",
        description:
          "Outlook crashes every time I try to open the shared office calendar in Teams. I've restarted my laptop twice and the error keeps happening.",
        departmentKey: "TECHNOLOGY_SUPPORT",
        category: "Software Issue",
        priority: "MEDIUM",
      },
      {
        subject: "Need updated logo files for the office signage",
        description:
          "We're replacing the reception signage and I need the latest brand-approved logo files and colour guidelines from marketing.",
        departmentKey: "MARKETING",
        category: "Brand Assets",
        priority: "LOW",
      },
    ],
    behavior: { patience: 0.75, escalationThreshold: 0.2 },
  },
  {
    key: "sim-customer-construction-worker",
    displayName: "Sim Customer - Construction Worker",
    email: "sim.customer.construction-worker@sim.example.test",
    description: "On-site crew member submitting requests from a job site, usually on a phone.",
    skills: ["low tech literacy", "terse, informal mobile-style messages", "needs plain-language clarification"],
    commonDepartments: ["TECHNOLOGY_SUPPORT", "TRAINING"],
    scenarios: [
      {
        subject: "Site office printer offline again",
        description:
          "printer in the site office is offline again cant print the inspection sheets need this fixed today please",
        departmentKey: "TECHNOLOGY_SUPPORT",
        category: "Hardware",
        priority: "MEDIUM",
      },
      {
        subject: "Forklift certification expiring",
        description:
          "my forklift certification is expiring next month and i need to know how to sign up for the renewal training course",
        departmentKey: "TRAINING",
        category: "Certification",
        priority: "MEDIUM",
      },
    ],
    behavior: { patience: 0.5, escalationThreshold: 0.25 },
  },
  {
    key: "sim-customer-site-supervisor",
    displayName: "Sim Customer - Site Supervisor",
    email: "sim.customer.site-supervisor@sim.example.test",
    description: "On-site foreman responsible for crew safety and day-to-day site operations.",
    skills: ["safety/urgency framing", "moderate tech literacy", "cross-functional requests"],
    commonDepartments: ["TECHNOLOGY_SUPPORT", "TRAINING", "ACCOUNTING_SERVICES"],
    scenarios: [
      {
        subject: "Wi-Fi down at the site trailer, crew can't access safety documents",
        description:
          "The wifi at the site trailer has been down since this morning and the crew can't pull up the safety documents on the tablet. This is a safety concern ahead of today's inspection.",
        departmentKey: "TECHNOLOGY_SUPPORT",
        category: "Network Outage",
        priority: "URGENT",
      },
      {
        subject: "Reimbursement for site safety equipment purchase",
        description:
          "I had to buy extra safety equipment for the crew this week and need to submit it for expense reimbursement. Can someone confirm the process?",
        departmentKey: "ACCOUNTING_SERVICES",
        category: "Expense Reimbursement",
        priority: "LOW",
      },
    ],
    behavior: { patience: 0.55, escalationThreshold: 0.45 },
  },
  {
    key: "sim-customer-new-hire",
    displayName: "Sim Customer - New Franchisee / New Hire",
    email: "sim.customer.new-hire@sim.example.test",
    description: "Recently onboarded franchisee or head-office hire, still learning the systems.",
    skills: ["very low system familiarity", "asks many clarifying questions", "patient but easily confused"],
    commonDepartments: ["TRAINING", "TECHNOLOGY_SUPPORT"],
    scenarios: [
      {
        subject: "How do I get started with the onboarding course?",
        description:
          "I just joined as a new franchise partner and I'm not sure how to access the onboarding training or which courses I need to complete first.",
        departmentKey: "TRAINING",
        category: "Onboarding",
        priority: "LOW",
      },
      {
        subject: "Can't log in to my new laptop with company email",
        description:
          "I got my new laptop today and I can't log in with my company email. It keeps saying the password is incorrect even though I reset it this morning.",
        departmentKey: "TECHNOLOGY_SUPPORT",
        category: "Login Issue",
        priority: "MEDIUM",
      },
    ],
    behavior: { patience: 0.85, escalationThreshold: 0.1 },
  },
];

export function findCustomerPersona(key: string): CustomerPersona {
  const persona = CUSTOMER_PERSONAS.find((p) => p.key === key);
  if (!persona) throw new Error(`Unknown customer persona key: ${key}`);
  return persona;
}
