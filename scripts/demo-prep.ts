import "dotenv/config";
import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";

/**
 * Puts the desk into a known state before a demo is given.
 *
 * Every tour walk -- and every `pnpm test:e2e` run -- creates real tickets,
 * and some create real articles and Markdown files. Sweeping afterwards was
 * always the plan (`pnpm demo:clean`), but "afterwards" depends on somebody
 * remembering, and the cost of forgetting used to be invisible: leftovers
 * sat at the far end of an oldest-first queue where nobody looked.
 *
 * That changed when department queues moved to newest-first. Leftovers now
 * sort to the TOP of the queue -- the first thing a room sees on the beat
 * where Alex opens his team's work. So preparation belongs at the START of a
 * demo, where it cannot be forgotten.
 *
 *   pnpm demo:prep
 *
 * This RESETS the local database rather than sweeping it, and the difference
 * matters: `demo:clean` keys off the one-off token the tour plants, so it can
 * only ever find the tour's own litter. The other e2e specs create tickets
 * with no token at all -- on the machine this was written on they were the
 * top three rows of the queue the demo opens, and no sweep would have found
 * them. A reset is the only thing that makes the desk deterministic, which
 * is the whole point of prepping it.
 *
 * Destructive, and local-only: `pnpm db:reset` refuses to run against
 * anything that does not look like a local development database. If you have
 * exploration you want to keep, run `pnpm demo:clean --yes` instead and
 * accept that non-tour leftovers stay.
 */

/** What the room sees first on the queue beat. */
/** What the room sees first on the queue beat. */
const PREVIEW_ROWS = 3;
const TOUR_QUEUE = "TECHNOLOGY_SUPPORT";

const db = new PrismaClient();

function run(label: string, command: string): void {
  console.log(`\n-- ${label} ${"-".repeat(Math.max(0, 60 - label.length))}`);
  execSync(command, { stdio: "inherit" });
}

async function reportQueueHead(): Promise<void> {
  const department = await db.department.findUnique({ where: { key: TOUR_QUEUE } });
  if (!department) {
    console.log(`\nNo ${TOUR_QUEUE} department found -- has the seed run?`);
    return;
  }

  const [total, head] = await Promise.all([
    db.ticket.count({ where: { departmentId: department.id } }),
    db.ticket.findMany({
      where: { departmentId: department.id },
      orderBy: { createdAt: "desc" },
      take: PREVIEW_ROWS,
      select: { ticketNumber: true, subject: true },
    }),
  ]);

  // The queue is newest-first, so this is literally the top of the page the
  // audience will be looking at -- read it before you present. Anything here
  // you do not recognise is something you left behind, not seed data.
  console.log(`\n-- What the room will see -----------------------------------------\n`);
  console.log(`  ${TOUR_QUEUE} queue: ${total} ticket(s). Top of the first page:`);
  for (const t of head) console.log(`    ${t.ticketNumber}  ${t.subject}`);
}

async function main() {
  console.log(
    "Resetting the local database so the demo starts from the seeded desk.\n" +
      "Anything you created by hand goes too -- `pnpm demo:clean --yes` is the\n" +
      "gentler option if that matters.",
  );
  run("Resetting and reseeding", "pnpm db:reset");
  await reportQueueHead();
  console.log("\nReady. Start the app with `pnpm dev`.\n");
  await db.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await db.$disconnect();
  process.exit(1);
});
