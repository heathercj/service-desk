import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { listAllArticleFiles, readArticleFile } from "../src/lib/knowledge/markdown-repo";

const db = new PrismaClient();

/**
 * Re-syncs KnowledgeArticle DB rows from the Markdown files on disk
 * (Section 11: "Add a command that validates and reindexes all Markdown
 * files"). Run `pnpm kb:validate` first -- this command trusts that the
 * files are already well-formed.
 */
async function main() {
  const files = await listAllArticleFiles();
  let updated = 0;
  let skipped = 0;

  for (const relativePath of files) {
    const { frontMatter, contentHash } = await readArticleFile(relativePath);

    const department = await db.department.findUnique({
      where: { key: frontMatter.department },
    });
    if (!department) {
      console.warn(
        `Skipping ${relativePath}: unknown department "${frontMatter.department}"`,
      );
      skipped++;
      continue;
    }

    const existing = await db.knowledgeArticle.findUnique({
      where: { articleKey: frontMatter.id },
    });
    if (existing && existing.contentHash === contentHash) {
      continue; // already in sync
    }

    const createdBy = await db.user.findUnique({ where: { id: frontMatter.createdBy } });
    if (!createdBy) {
      console.warn(
        `Skipping ${relativePath}: createdBy user "${frontMatter.createdBy}" does not exist`,
      );
      skipped++;
      continue;
    }

    await db.knowledgeArticle.upsert({
      where: { articleKey: frontMatter.id },
      create: {
        articleKey: frontMatter.id,
        slug: frontMatter.slug,
        departmentId: department.id,
        title: frontMatter.title,
        summary: frontMatter.summary,
        status: frontMatter.status.toUpperCase() as
          | "DRAFT"
          | "IN_REVIEW"
          | "PUBLISHED"
          | "ARCHIVED",
        internalOnly: frontMatter.internalOnly,
        filePath: relativePath,
        contentHash,
        revision: frontMatter.revision,
        createdById: frontMatter.createdBy,
      },
      update: {
        title: frontMatter.title,
        summary: frontMatter.summary,
        status: frontMatter.status.toUpperCase() as
          | "DRAFT"
          | "IN_REVIEW"
          | "PUBLISHED"
          | "ARCHIVED",
        internalOnly: frontMatter.internalOnly,
        contentHash,
        revision: frontMatter.revision,
      },
    });
    updated++;
  }

  console.log(
    `Reindex complete: ${updated} article(s) updated, ${skipped} skipped, ${files.length} scanned.`,
  );
}

main()
  .catch((err) => {
    console.error("kb:reindex failed:", err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
