import type { DepartmentKey } from "@prisma/client";

/**
 * Deterministic department suggestion shown to triage (Section 7:
 * "Suggested department with rationale"). Keyword-based and fully local --
 * no AI/embedding call. This is intentionally a starting point the triage
 * agent can override, not an autonomous routing decision.
 */
const DEPARTMENT_KEYWORDS: Record<DepartmentKey, string[]> = {
  TECHNOLOGY_SUPPORT: [
    "password",
    "login",
    "vpn",
    "wifi",
    "wi-fi",
    "laptop",
    "computer",
    "printer",
    "email",
    "outlook",
    "network",
    "server",
    "software",
    "install",
    "crash",
    "error",
    "virus",
    "malware",
    "backup",
    "sync",
    "teams",
    "sharepoint",
  ],
  TRAINING: [
    "training",
    "course",
    "onboarding",
    "certification",
    "learning",
    "workshop",
    "tutorial",
  ],
  ACCOUNTING_SERVICES: [
    "invoice",
    "payment",
    "payroll",
    "expense",
    "budget",
    "billing",
    "accounts payable",
    "accounts receivable",
    "reimbursement",
    "tax",
    "financial",
  ],
  MARKETING: [
    "campaign",
    "brand",
    "logo",
    "social media",
    "advertising",
    "website content",
    "flyer",
    "signage",
  ],
  LEGAL: [
    "contract",
    "agreement",
    "compliance",
    "dispute",
    "liability",
    "legal",
    "trademark",
    "nda",
  ],
  IMPROVEMENT_IDEAS: [
    "idea",
    "suggestion",
    "improve",
    "improvement",
    "enhancement",
    "feature request",
  ],
};

/**
 * Customers no longer pick a department when submitting a ticket: every
 * ticket is auto-routed by keyword match, falling back to this department
 * when nothing matches. Triage reviews and corrects routing via the
 * existing "Confirm triage & route" action -- this is only the intake
 * default, not a final decision.
 */
export const DEFAULT_DEPARTMENT_KEY: DepartmentKey = "TECHNOLOGY_SUPPORT";

export interface DepartmentSuggestion {
  departmentKey: DepartmentKey;
  rationale: string;
  matchedKeywords: string[];
}

export function suggestDepartment(
  subject: string,
  description: string,
): DepartmentSuggestion | null {
  const text = `${subject} ${description}`.toLowerCase();

  let best: { key: DepartmentKey; matches: string[] } | null = null;

  for (const [key, keywords] of Object.entries(DEPARTMENT_KEYWORDS) as [
    DepartmentKey,
    string[],
  ][]) {
    const matches = keywords.filter((kw) => text.includes(kw));
    if (matches.length > 0 && (!best || matches.length > best.matches.length)) {
      best = { key, matches };
    }
  }

  if (!best) return null;

  return {
    departmentKey: best.key,
    rationale: `Matched keyword(s): ${best.matches.join(", ")}`,
    matchedKeywords: best.matches,
  };
}
