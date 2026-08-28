import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { listAllArticleFiles, readArticleFile } from "../src/lib/knowledge/markdown-repo";
import { departmentKeyToFolder } from "../src/lib/knowledge/department-folders";
import path from "node:path";

/**
 * CI content check (Section 11): fails the build on invalid front matter,
 * duplicate IDs, duplicate slugs within a department, unsafe links, or
 * malformed Markdown. Run via `pnpm kb:validate`.
 *
 * "Is this a recognized department folder" is checked against real
 * Department rows, not a hand-maintained allow-list or a guessed reverse
 * transform -- departments are created by administrators at runtime
 * (Section: self-service departments), so a fixed list would either reject
 * a legitimately new department or (worse, if merely computed rather than
 * looked up) let a typo'd folder validate against itself.
 */

const db = new PrismaClient();

const UNSAFE_LINK_PATTERN = /\]\(\s*(javascript|data|file|vbscript):/i;

async function main() {
  const departments = await db.department.findMany({ select: { key: true } });
  const departmentKeyByFolder = new Map(
    departments.map((d) => [departmentKeyToFolder(d.key), d.key]),
  );

  const files = await listAllArticleFiles();
  const errors: string[] = [];
  const seenIds = new Map<string, string>();
  const seenSlugsByDept = new Map<string, Map<string, string>>();

  if (files.length === 0) {
    console.warn("No knowledge-base articles found -- nothing to validate.");
  }

  for (const relativePath of files) {
    const topFolder = relativePath.split(path.sep)[0] ?? "";
    const expectedDeptKeyFromFolder = departmentKeyByFolder.get(topFolder);
    if (!expectedDeptKeyFromFolder) {
      errors.push(`${relativePath}: not under a recognized department folder`);
      continue;
    }

    let parsed;
    try {
      parsed = await readArticleFile(relativePath);
    } catch (err) {
      errors.push(`${relativePath}: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }

    const { frontMatter, body } = parsed;

    if (frontMatter.department !== expectedDeptKeyFromFolder) {
      errors.push(
        `${relativePath}: front matter department "${frontMatter.department}" does not match folder "${topFolder}"`,
      );
    }

    if (seenIds.has(frontMatter.id)) {
      errors.push(
        `${relativePath}: duplicate article id "${frontMatter.id}" (also in ${seenIds.get(frontMatter.id)})`,
      );
    } else {
      seenIds.set(frontMatter.id, relativePath);
    }

    const deptSlugs =
      seenSlugsByDept.get(frontMatter.department) ?? new Map<string, string>();
    if (deptSlugs.has(frontMatter.slug)) {
      errors.push(
        `${relativePath}: duplicate slug "${frontMatter.slug}" within department "${frontMatter.department}" (also in ${deptSlugs.get(frontMatter.slug)})`,
      );
    } else {
      deptSlugs.set(frontMatter.slug, relativePath);
    }
    seenSlugsByDept.set(frontMatter.department, deptSlugs);

    if (UNSAFE_LINK_PATTERN.test(body)) {
      errors.push(
        `${relativePath}: contains an unsafe link scheme (javascript:/data:/file:/vbscript:)`,
      );
    }

    if (body.length === 0) {
      errors.push(`${relativePath}: article body is empty`);
    }
  }

  if (errors.length > 0) {
    console.error(`Knowledge-base validation failed with ${errors.length} error(s):\n`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }

  console.log(`Knowledge-base validation passed for ${files.length} article(s).`);
}

main()
  .catch((err) => {
    console.error("kb:validate crashed:", err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
