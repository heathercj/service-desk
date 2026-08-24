import "dotenv/config";
import { promises as fs } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import {
  KNOWLEDGE_BASE_ROOT,
  listAllArticleFiles,
} from "../src/lib/knowledge/markdown-repo";

/**
 * Clears up after the guided demo tour and the golden-path e2e walk.
 *
 * Both plant a one-off run token in the ticket subject, which carries into
 * the article drafted from it -- so this keys off that token rather than
 * guessing from filenames. Every run leaves behind a ticket, an article row,
 * and a real Markdown file under knowledge-base/, and the files are the part
 * that leaks into version control if nobody sweeps them.
 *
 * Destructive, so it reports and does nothing unless passed --yes.
 *
 *   pnpm demo:clean          # show what would go
 *   pnpm demo:clean --yes    # actually remove it
 */
const TOKEN = /(henry|grommet)[0-9a-z]{6,}/i;

const db = new PrismaClient();

function refuseIfNotLocal(): void {
  if (process.env.NODE_ENV === "production") {
    console.error("Refusing to run: NODE_ENV=production.");
    process.exit(1);
  }
  const url = process.env.DATABASE_URL ?? "";
  if (
    !url.includes("localhost") &&
    !url.includes("127.0.0.1") &&
    !url.includes("postgres:5432")
  ) {
    console.error(
      "Refusing to run: DATABASE_URL does not look like a local development database.\n" +
        `  DATABASE_URL="${url}"`,
    );
    process.exit(1);
  }
}

async function main() {
  refuseIfNotLocal();
  const commit = process.argv.includes("--yes");

  // Tickets first. TicketKnowledgeLink does NOT cascade from the article
  // side, so an article still linked to a ticket cannot be deleted -- but
  // the link does cascade from the ticket, so removing the ticket clears
  // the way.
  const tickets = (
    await db.ticket.findMany({ select: { id: true, ticketNumber: true, subject: true } })
  ).filter((t) => TOKEN.test(t.subject));

  const articles = (
    await db.knowledgeArticle.findMany({
      select: { id: true, title: true, filePath: true },
    })
  ).filter((a) => TOKEN.test(a.title));

  // Files whose article row is already gone -- typically a db:reset between
  // demo runs. Nothing in the database points at these any more, so they
  // would otherwise sit in the working tree forever.
  const tracked = new Set(articles.map((a) => a.filePath));
  const orphanFiles = (await listAllArticleFiles()).filter(
    (rel) => TOKEN.test(rel) && !tracked.has(rel),
  );

  console.log(`Demo litter found:`);
  console.log(`  ${tickets.length} ticket(s)`);
  for (const t of tickets) console.log(`    ${t.ticketNumber}  ${t.subject}`);
  console.log(`  ${articles.length} article row(s), each with its Markdown file`);
  for (const a of articles) console.log(`    ${a.filePath}`);
  console.log(`  ${orphanFiles.length} orphaned Markdown file(s)`);
  for (const f of orphanFiles) console.log(`    ${f}`);

  if (tickets.length + articles.length + orphanFiles.length === 0) {
    console.log("\nNothing to clean.");
    return;
  }

  if (!commit) {
    console.log("\nDry run. Re-run with --yes to remove all of the above.");
    return;
  }

  if (tickets.length > 0) {
    await db.ticket.deleteMany({ where: { id: { in: tickets.map((t) => t.id) } } });
  }
  if (articles.length > 0) {
    await db.knowledgeArticle.deleteMany({
      where: { id: { in: articles.map((a) => a.id) } },
    });
  }

  for (const rel of [...articles.map((a) => a.filePath), ...orphanFiles]) {
    // Resolved against the knowledge base root and checked, so a bad
    // filePath in the database cannot reach outside it.
    const abs = path.resolve(KNOWLEDGE_BASE_ROOT, rel);
    if (!abs.startsWith(KNOWLEDGE_BASE_ROOT + path.sep)) {
      console.error(`  skipped (outside knowledge-base/): ${rel}`);
      continue;
    }
    await fs.rm(abs, { force: true });
  }

  console.log(
    `\nRemoved ${tickets.length} ticket(s), ${articles.length} article(s), and ` +
      `${articles.length + orphanFiles.length} file(s).`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => void db.$disconnect());
