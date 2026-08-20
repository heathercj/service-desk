import { z } from "zod";
import { DEPARTMENT_KEYS } from "@/lib/validation/ticket-schemas";

export const KNOWLEDGE_STATUSES = [
  "draft",
  "in_review",
  "published",
  "archived",
] as const;

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Validated Markdown front matter (Section 11). Every field the spec asks
 * for is required or explicitly optional here -- nothing is inferred
 * silently, and `kb:validate` (scripts/kb-validate.ts) runs this schema
 * against every file in knowledge-base/ so CI fails on drift.
 */
export const knowledgeFrontMatterSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(3).max(150),
  slug: z
    .string()
    .regex(
      SLUG_PATTERN,
      "Slug must be lowercase, hyphenated, no spaces or path separators",
    ),
  summary: z.string().min(10).max(500),
  department: z.enum(DEPARTMENT_KEYS),
  audience: z.string().max(80).optional(),
  status: z.enum(KNOWLEDGE_STATUSES),
  tags: z.array(z.string().min(1).max(40)).max(15).default([]),
  createdDate: z.string().date(),
  updatedDate: z.string().date(),
  createdBy: z.string().min(1),
  reviewedBy: z.string().optional(),
  sourceTicketIds: z.array(z.string()).default([]),
  revision: z.number().int().positive(),
  supersedes: z.string().optional(),
});

export type KnowledgeFrontMatter = z.infer<typeof knowledgeFrontMatterSchema>;

export function slugify(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}
