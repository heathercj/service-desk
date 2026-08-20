import "server-only";
import type { Prisma, PrismaClient } from "@prisma/client";

const PREFIX = "SD";
const PAD_WIDTH = 6;

type Executor = PrismaClient | Prisma.TransactionClient;

/**
 * Generates the next immutable, human-readable ticket number (Section 10)
 * from a single counter row. Must be called inside the same transaction
 * that creates the Ticket row so a crash between the two never burns a
 * number silently (it just means the counter has a gap, which is fine --
 * gaps are expected and harmless for a ticket number).
 */
export async function nextTicketNumber(tx: Executor): Promise<string> {
  const counter = await tx.ticketNumberCounter.upsert({
    where: { id: 1 },
    create: { id: 1, value: 1 },
    update: { value: { increment: 1 } },
  });
  return `${PREFIX}-${String(counter.value).padStart(PAD_WIDTH, "0")}`;
}
