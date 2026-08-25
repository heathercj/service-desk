import "server-only";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { recordAuditEvent } from "@/lib/audit/audit-log";
import { requireActiveDepartment } from "./department-lookup";
import { DEFAULT_DEPARTMENT_KEY, suggestDepartment } from "./department-suggestion";
import { lookupEntraUser, resolveFranchiseForDepartment } from "./franchise-lookup";
import { nextTicketNumber } from "./ticket-number";

/**
 * Turns an inbound support@alairhomes.com email into a ticket, straight
 * into Triage -- the same SUBMITTED state a web-submitted ticket starts
 * in. Called from src/app/api/webhooks/graph-email/route.ts once it has
 * fetched a changed message's content from Graph. There is no signed-in
 * actor for an inbound email, so this does its own identity resolution
 * rather than taking an AuthContext.
 */
export interface ParsedInboundEmail {
  graphMessageId: string;
  fromEmail: string;
  fromName: string;
  subject: string;
  bodyText: string;
}

export interface CreateTicketFromEmailResult {
  ticketId: string;
  /** false if this graphMessageId was already processed (Graph redelivery). */
  created: boolean;
}

interface ResolvedSubmitter {
  userId: string;
  displayName: string;
  department: string | null;
}

/**
 * One Graph directory lookup serves both identity and franchise: the
 * sender's local User row is reused/provisioned from it, and its
 * `department` feeds resolveFranchiseForDepartment(). Internal-staff-only
 * is the expectation (docs/ENTRA_SETUP.md), so a sender with no Entra
 * match at all is treated as an anomaly worth investigating, not silently
 * dropped -- a placeholder identity is created so the request isn't lost.
 */
async function resolveSubmitter(
  fromEmail: string,
  fromName: string,
): Promise<ResolvedSubmitter> {
  const profile = await lookupEntraUser(fromEmail);

  const local = await db.user.findFirst({ where: { email: fromEmail } });
  if (local) {
    return {
      userId: local.id,
      displayName: local.displayName,
      department: profile?.department ?? null,
    };
  }

  if (profile) {
    const provisioned = await db.user.upsert({
      where: { entraObjectId: profile.id },
      create: {
        entraObjectId: profile.id,
        entraTenantId: env.ENTRA_TENANT_ID,
        email: profile.mail ?? fromEmail,
        displayName: profile.displayName,
      },
      update: {},
    });
    return {
      userId: provisioned.id,
      displayName: provisioned.displayName,
      department: profile.department,
    };
  }

  console.error(
    `email-intake: no local account or Entra match for sender "${fromEmail}" -- ` +
      "creating a placeholder identity so the request isn't lost. Investigate: " +
      "mail reached support@ from someone this design didn't expect to.",
  );
  const placeholder = await db.user.create({
    data: {
      entraObjectId: `email-intake:${randomUUID()}`,
      entraTenantId: env.ENTRA_TENANT_ID,
      email: fromEmail,
      displayName: fromName || fromEmail,
    },
  });
  return {
    userId: placeholder.id,
    displayName: placeholder.displayName,
    department: null,
  };
}

const UNIQUE_CONSTRAINT_VIOLATION = "P2002";

export async function createTicketFromEmail(
  parsed: ParsedInboundEmail,
): Promise<CreateTicketFromEmailResult> {
  const existing = await db.emailIntakeMessage.findUnique({
    where: { graphMessageId: parsed.graphMessageId },
  });
  if (existing) return { ticketId: existing.ticketId, created: false };

  const submitter = await resolveSubmitter(parsed.fromEmail, parsed.fromName);

  // Same auto-routing as the web form (Section: ticket intake) -- Triage
  // reviews and corrects via "Confirm triage & route".
  const suggestion = suggestDepartment(parsed.subject, parsed.bodyText);
  const department = await requireActiveDepartment(
    suggestion?.departmentKey ?? DEFAULT_DEPARTMENT_KEY,
  );
  const franchise = await resolveFranchiseForDepartment(submitter.department);

  try {
    const ticket = await db.$transaction(async (tx) => {
      const ticketNumber = await nextTicketNumber(tx);

      const created = await tx.ticket.create({
        data: {
          ticketNumber,
          submittedById: submitter.userId,
          submittedName: submitter.displayName,
          submittedEmail: parsed.fromEmail,
          franchiseId: franchise.id,
          subject: parsed.subject,
          description: parsed.bodyText,
          submittedDepartmentId: department.id,
          departmentId: department.id,
          suggestedDepartmentRationale:
            suggestion?.rationale ??
            "No matching keywords in subject/description -- defaulted to Technology Support",
          isProjectRelated: false,
          status: "SUBMITTED",
          source: "EMAIL",
        },
      });

      await tx.ticketStatusHistory.create({
        data: {
          ticketId: created.id,
          fromStatus: null,
          toStatus: "SUBMITTED",
          changedById: submitter.userId,
        },
      });

      // The unique constraint on graphMessageId is the real idempotency
      // guarantee -- the findUnique above is just a fast path. A race
      // between two deliveries of the same notification ends here: the
      // loser's insert throws P2002, the transaction rolls back (so no
      // duplicate Ticket persists), and the catch below reports it as
      // "already processed" rather than a failure.
      await tx.emailIntakeMessage.create({
        data: { graphMessageId: parsed.graphMessageId, ticketId: created.id },
      });

      await recordAuditEvent(
        {
          actorId: submitter.userId,
          actorDisplayName: submitter.displayName,
          action: "TICKET_CREATED_FROM_EMAIL",
          entityType: "Ticket",
          entityId: created.id,
          newValue: { ticketNumber, departmentId: department.id, source: "EMAIL" },
        },
        tx,
      );

      return created;
    });

    return { ticketId: ticket.id, created: true };
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === UNIQUE_CONSTRAINT_VIOLATION
    ) {
      const winner = await db.emailIntakeMessage.findUniqueOrThrow({
        where: { graphMessageId: parsed.graphMessageId },
      });
      return { ticketId: winner.ticketId, created: false };
    }
    throw err;
  }
}
