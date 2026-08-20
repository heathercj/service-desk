import "server-only";
import type { Prisma, PrismaClient } from "@prisma/client";
import { db } from "@/lib/db";

/**
 * Append-only audit trail (Section 15). Every call here is an INSERT --
 * there is no update/delete path in the application. Values are redacted
 * before they ever reach the database so a bug elsewhere can't leak a
 * secret into a table product managers routinely export/read.
 */

const REDACTED = "[redacted]";
const SENSITIVE_KEY_PATTERN =
  /password|secret|token|authorization|api[-_ ]?key|ssn|credit[-_ ]?card/i;

export function redactValue(value: unknown, depth = 0): unknown {
  if (depth > 4) return REDACTED;
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((v) => redactValue(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SENSITIVE_KEY_PATTERN.test(key) ? REDACTED : redactValue(val, depth + 1);
    }
    return out;
  }
  return value;
}

export interface AuditEventInput {
  actorId: string | null;
  actorDisplayName: string;
  action: string;
  entityType: string;
  entityId: string;
  previousValue?: Record<string, unknown> | null;
  newValue?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
}

type Executor = PrismaClient | Prisma.TransactionClient;

export async function recordAuditEvent(
  input: AuditEventInput,
  executor: Executor = db,
): Promise<void> {
  await executor.auditEvent.create({
    data: {
      actorId: input.actorId,
      actorDisplayName: input.actorDisplayName,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      previousValue:
        (redactValue(input.previousValue ?? null) as Prisma.InputJsonValue) ?? undefined,
      newValue:
        (redactValue(input.newValue ?? null) as Prisma.InputJsonValue) ?? undefined,
      metadata:
        (redactValue(input.metadata ?? null) as Prisma.InputJsonValue) ?? undefined,
    },
  });
}
