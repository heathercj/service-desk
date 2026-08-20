// Deliberately NOT `import "server-only"` here: this module is also used
// directly by standalone Node scripts (prisma/seed.ts, scripts/kb-*.ts)
// that run outside Next.js's bundler, where the server-only marker always
// throws. It performs filesystem I/O, so it could never run in a browser
// bundle regardless.
import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import matter from "gray-matter";
import {
  knowledgeFrontMatterSchema,
  SLUG_PATTERN,
  type KnowledgeFrontMatter,
} from "./front-matter-schema";
import { departmentKeyToFolder } from "./department-folders";

/**
 * Markdown knowledge-article repository (Section 11). All reads/writes go
 * through here so slug/path validation and front-matter validation are
 * enforced in exactly one place, rather than trusted at every call site.
 */

export const KNOWLEDGE_BASE_ROOT = path.join(process.cwd(), "knowledge-base");

export interface KnowledgeArticleFile {
  frontMatter: KnowledgeFrontMatter;
  body: string;
  relativePath: string;
  contentHash: string;
}

function assertSafeSlug(slug: string): void {
  if (!SLUG_PATTERN.test(slug)) {
    throw new Error(`Unsafe or malformed slug: ${slug}`);
  }
}

export function articleRelativePath(departmentKey: string, slug: string): string {
  assertSafeSlug(slug);
  const folder = departmentKeyToFolder(departmentKey);
  return path.join(folder, `${slug}.md`);
}

function resolveAndVerify(relativePath: string): string {
  const resolved = path.resolve(KNOWLEDGE_BASE_ROOT, relativePath);
  const rootWithSep = KNOWLEDGE_BASE_ROOT.endsWith(path.sep)
    ? KNOWLEDGE_BASE_ROOT
    : KNOWLEDGE_BASE_ROOT + path.sep;
  if (!resolved.startsWith(rootWithSep)) {
    throw new Error(`Refusing to access path outside knowledge-base/: ${relativePath}`);
  }
  return resolved;
}

function hashContent(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export async function readArticleFile(
  relativePath: string,
): Promise<KnowledgeArticleFile> {
  const absolutePath = resolveAndVerify(relativePath);
  const raw = await fs.readFile(absolutePath, "utf8");
  const parsed = matter(raw);
  const frontMatter = knowledgeFrontMatterSchema.parse(parsed.data);
  return {
    frontMatter,
    body: parsed.content.trim(),
    relativePath,
    contentHash: hashContent(raw),
  };
}

export async function writeArticleFile(
  departmentKey: string,
  slug: string,
  frontMatter: KnowledgeFrontMatter,
  body: string,
): Promise<KnowledgeArticleFile> {
  knowledgeFrontMatterSchema.parse(frontMatter); // fail loudly before touching disk
  const relativePath = articleRelativePath(departmentKey, slug);
  const absolutePath = resolveAndVerify(relativePath);

  const raw = matter.stringify(body.trim() + "\n", frontMatter);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, raw, "utf8");

  return { frontMatter, body: body.trim(), relativePath, contentHash: hashContent(raw) };
}

export async function listAllArticleFiles(): Promise<string[]> {
  const results: string[] = [];
  async function walk(dir: string) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        results.push(path.relative(KNOWLEDGE_BASE_ROOT, full));
      }
    }
  }
  await walk(KNOWLEDGE_BASE_ROOT);
  return results;
}
