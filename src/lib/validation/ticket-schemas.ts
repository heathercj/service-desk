import { z } from "zod";
import { validateProjectNumber } from "./project-number";
import { MAX_URLS_PER_TICKET, MAX_URL_LENGTH, validateSubmittedUrl } from "./url-safety";

export const DEPARTMENT_KEYS = [
  "TECHNOLOGY_SUPPORT",
  "TRAINING",
  "ACCOUNTING_SERVICES",
  "MARKETING",
  "LEGAL",
] as const;

export const MIN_DESCRIPTION_LENGTH = 30;
export const MAX_SUBJECT_LENGTH = 150;
export const MAX_DESCRIPTION_LENGTH = 8000;

function normalizeText(value: string): string {
  return value.replace(/\r\n/g, "\n").trim();
}

const urlSchema = z
  .string()
  .max(MAX_URL_LENGTH)
  .refine(
    (v) =>
      validateSubmittedUrl(v, { allowHttp: process.env.NODE_ENV !== "production" }).ok,
    {
      message: "Enter a safe https:// URL (http:// only in local development)",
    },
  );

// Kept as a plain ZodObject (not yet superRefine-wrapped) so callers like
// the client form can still call `.omit()`/`.pick()` on it -- ZodEffects
// (the type superRefine returns) doesn't support those. The cross-field
// project-number check is applied separately in `createTicketSchema` below
// and is re-validated there even if a caller skips it earlier.
export const createTicketObjectSchema = z.object({
  franchiseId: z.string().uuid(),
  subject: z
    .string()
    .trim()
    .min(1, "Subject is required")
    .max(MAX_SUBJECT_LENGTH)
    .transform(normalizeText),
  description: z
    .string()
    .trim()
    .min(
      MIN_DESCRIPTION_LENGTH,
      `Please describe the issue in at least ${MIN_DESCRIPTION_LENGTH} characters`,
    )
    .max(MAX_DESCRIPTION_LENGTH)
    .transform(normalizeText),
  isProjectRelated: z.boolean(),
  projectNumber: z.string().trim().optional(),
  urls: z.array(urlSchema).max(MAX_URLS_PER_TICKET).default([]),
  impact: z.string().trim().max(500).optional(),
  urgencyNote: z.string().trim().max(500).optional(),
  consentAcknowledged: z.literal(true, {
    errorMap: () => ({
      message:
        "You must confirm the ticket does not contain passwords, tokens, payment data, or unneeded personal information",
    }),
  }),
  attemptedArticleIds: z.array(z.string()).default([]),
});

export const createTicketSchema = createTicketObjectSchema.superRefine((data, ctx) => {
  if (data.isProjectRelated) {
    const projectNumber = data.projectNumber ?? "";
    const result = validateProjectNumber(projectNumber);
    if (!result.ok) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["projectNumber"],
        message: result.reason ?? "Invalid project number",
      });
    }
  }
});

export type CreateTicketInput = z.infer<typeof createTicketSchema>;

export const conversationMessageSchema = z.object({
  ticketId: z.string().uuid(),
  body: z
    .string()
    .trim()
    .min(1, "Message cannot be empty")
    .max(5000)
    .transform(normalizeText),
  version: z.number().int().positive(),
});

export const internalNoteSchema = z.object({
  ticketId: z.string().uuid(),
  body: z
    .string()
    .trim()
    .min(1, "Note cannot be empty")
    .max(5000)
    .transform(normalizeText),
});

export const triageActionSchema = z.object({
  ticketId: z.string().uuid(),
  version: z.number().int().positive(),
  franchiseId: z.string().uuid().optional(),
  departmentKey: z.enum(DEPARTMENT_KEYS),
  category: z.string().trim().max(80).optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]),
  tags: z.array(z.string().trim().min(1).max(40)).max(10).default([]),
  internalNote: z.string().trim().max(2000).optional(),
});

export const resolveTicketSchema = z.object({
  ticketId: z.string().uuid(),
  version: z.number().int().positive(),
  resolutionSummary: z.string().trim().min(10).max(4000).transform(normalizeText),
  resolutionSteps: z.string().trim().min(10).max(8000).transform(normalizeText),
});

export const statusChangeSchema = z.object({
  ticketId: z.string().uuid(),
  version: z.number().int().positive(),
  toStatus: z.enum([
    "IN_TRIAGE",
    "WAITING_FOR_CUSTOMER",
    "QUEUED",
    "ASSIGNED",
    "IN_PROGRESS",
    "PENDING",
    "RESOLUTION_REVIEW",
    "RESOLVED",
    "CLOSED",
    "REOPENED",
    "CANCELLED",
  ]),
  reason: z.string().trim().max(2000).optional(),
});
