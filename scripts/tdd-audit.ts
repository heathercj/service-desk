/**
 * `pnpm tdd:audit` -- evidence, not assertion, for whether feature work in
 * this repo is actually being test-driven the way docs/TESTING.md describes.
 *
 * For every feature file (a service/module under src/lib, an API route
 * handler, or a component) this finds the test file covering it -- same
 * directory, matching name -- and asks git two questions: which commit
 * first introduced the implementation, and which first introduced the
 * test? A test landing in that same commit, or an earlier one, is
 * consistent with "write the test first, then the code" -- this repo's
 * history is squash-per-feature, so same-commit is the expected shape of a
 * disciplined TDD cycle, not a tie. A test that lands in a later, separate
 * commit is the one honest signal of a test retrofitted after the fact.
 *
 * This can only see file layout and commit order, not whether a test was
 * ever actually run red before it went green -- that would need CI logs
 * this repo doesn't keep. Treat "test-after" as "worth a second look", not
 * as a violation: a regression test added once a bug was found is exactly
 * this shape and is still good practice.
 *
 * Exit code is 1 only on a tooling failure (not a git repo, no src/
 * directory). Findings never fail the build -- an audit is a report, not
 * a gate, and "no test" or "test-after" both need a human reading the
 * list, not a CI job blocking on a heuristic.
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();

/**
 * git.exe is a real executable (unlike pnpm/playwright's .cmd shims on
 * Windows), so it never needs a shell wrapper -- which matters here, because
 * with shell:true on Windows every argument is concatenated into one command
 * line for cmd.exe with no escaping, and a bare `|` in a --format string
 * (e.g. "%H|%aI") is parsed as a real pipe, silently breaking the command
 * instead of erroring.
 */
function runGit(args: string[]): string | undefined {
  try {
    return execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return undefined;
  }
}

function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

function walk(dir: string, out: string[]): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
}

// --- Inventory ---------------------------------------------------------

// Next.js special filenames: routing/framework surface, not a business-logic
// unit. docs/TESTING.md's "Coverage priority" puts whole journeys through
// these in the e2e suite rather than asking for a unit test per page, so
// they are reported separately instead of counted as coverage gaps.
const FRAMEWORK_FILENAMES = new Set([
  "page.tsx",
  "layout.tsx",
  "template.tsx",
  "loading.tsx",
  "error.tsx",
  "global-error.tsx",
  "not-found.tsx",
]);

type Category = "lib" | "api-route" | "component";

interface FeatureFile {
  relPath: string;
  category: Category;
}

function isUnitTest(base: string): boolean {
  return /\.test\.tsx?$/.test(base) && !isIntegrationTest(base);
}
function isIntegrationTest(base: string): boolean {
  return /\.integration\.test\.ts$/.test(base);
}
function isAnyTest(base: string): boolean {
  return isUnitTest(base) || isIntegrationTest(base);
}

function discoverAllSourceFiles(): string[] {
  const all: string[] = [];
  walk(path.join(root, "src"), all);
  return all.map((f) => toPosix(path.relative(root, f))).filter((f) => /\.tsx?$/.test(f));
}

function discoverFeatureFiles(allFiles: string[]): FeatureFile[] {
  const features: FeatureFile[] = [];
  for (const relPath of allFiles) {
    const base = path.posix.basename(relPath);
    if (isAnyTest(base)) continue;

    if (relPath.startsWith("src/lib/")) {
      features.push({ relPath, category: "lib" });
    } else if (relPath.startsWith("src/app/api/") && base === "route.ts") {
      features.push({ relPath, category: "api-route" });
    } else if (
      relPath.startsWith("src/components/") &&
      base.endsWith(".tsx") &&
      !FRAMEWORK_FILENAMES.has(base)
    ) {
      features.push({ relPath, category: "component" });
    }
  }
  return features;
}

function discoverFrameworkEntryPoints(allFiles: string[]): string[] {
  return allFiles.filter(
    (relPath) =>
      relPath.startsWith("src/app/") &&
      FRAMEWORK_FILENAMES.has(path.posix.basename(relPath)),
  );
}

// --- Coverage: is there a test in the same directory? -------------------

type Coverage =
  | { kind: "none" }
  | { kind: "direct"; testPaths: string[] }
  | { kind: "grouped"; testPaths: string[] };

function findCoverage(feature: FeatureFile, testsByDir: Map<string, string[]>): Coverage {
  const dir = path.posix.dirname(feature.relPath);
  const base = path.posix.basename(feature.relPath).replace(/\.tsx?$/, "");
  const testsInDir = testsByDir.get(dir) ?? [];

  const direct = testsInDir.filter((t) => {
    const testBase = path.posix.basename(t);
    return (
      testBase === `${base}.test.ts` ||
      testBase === `${base}.test.tsx` ||
      testBase === `${base}.integration.test.ts`
    );
  });
  if (direct.length > 0) return { kind: "direct", testPaths: direct };
  if (testsInDir.length > 0) return { kind: "grouped", testPaths: testsInDir };
  return { kind: "none" };
}

// --- Git evidence: which commit introduced this file first? -------------

interface GitCommit {
  sha: string;
  date: string;
}

const firstCommitCache = new Map<string, GitCommit | undefined>();

function firstCommitFor(relPath: string): GitCommit | undefined {
  if (firstCommitCache.has(relPath)) return firstCommitCache.get(relPath);
  const out = runGit([
    "log",
    "--follow",
    "--diff-filter=A",
    "--format=%H%x09%aI",
    "--",
    relPath,
  ]);
  const lines = (out ?? "").trim().split(/\r?\n/).filter(Boolean);
  // git log prints newest first; the earliest introduction is the last line.
  const last = lines.length > 0 ? lines[lines.length - 1] : undefined;
  const [sha, date] = last?.split("\t") ?? [];
  const result = sha && date ? { sha, date } : undefined;
  firstCommitCache.set(relPath, result);
  return result;
}

type Evidence =
  | { kind: "no-test" }
  | { kind: "unversioned" }
  | { kind: "paired"; feature: GitCommit; test: GitCommit }
  | { kind: "test-first"; feature: GitCommit; test: GitCommit }
  | { kind: "test-after"; feature: GitCommit; test: GitCommit };

function classifyEvidence(feature: FeatureFile, coverage: Coverage): Evidence {
  if (coverage.kind === "none") return { kind: "no-test" };

  const featureCommit = firstCommitFor(feature.relPath);
  const testCommits = coverage.testPaths
    .map(firstCommitFor)
    .filter((c): c is GitCommit => !!c);
  if (!featureCommit || testCommits.length === 0) return { kind: "unversioned" };

  // The most favourable reading of "was a covering test written first":
  // the earliest of the (possibly several) tests sharing this file.
  const earliestTest = testCommits.reduce((a, b) =>
    new Date(a.date).getTime() <= new Date(b.date).getTime() ? a : b,
  );

  if (earliestTest.sha === featureCommit.sha) {
    return { kind: "paired", feature: featureCommit, test: earliestTest };
  }
  if (new Date(earliestTest.date).getTime() <= new Date(featureCommit.date).getTime()) {
    return { kind: "test-first", feature: featureCommit, test: earliestTest };
  }
  return { kind: "test-after", feature: featureCommit, test: earliestTest };
}

// --- BDD DSL adoption -----------------------------------------------------

const BDD_IMPORT_PATTERN = /from\s+["'][^"']*\/test\/bdd["']/;

function usesBddDsl(relPath: string): boolean {
  try {
    const content = readFileSync(path.join(root, ...relPath.split("/")), "utf8");
    return BDD_IMPORT_PATTERN.test(content);
  } catch {
    return false;
  }
}

// --- Report ---------------------------------------------------------------

function pct(n: number, of: number): string {
  if (of === 0) return "n/a";
  return `${Math.round((n / of) * 100)}%`;
}

function main(): void {
  if (!runGit(["rev-parse", "--is-inside-work-tree"])) {
    console.error("tdd:audit requires a git repository -- history is the whole point.");
    process.exit(1);
  }

  const allFiles = discoverAllSourceFiles();
  const features = discoverFeatureFiles(allFiles);
  const frameworkEntryPoints = discoverFrameworkEntryPoints(allFiles);
  const e2eSpecs = (() => {
    const out: string[] = [];
    walk(path.join(root, "e2e"), out);
    return out
      .map((f) => toPosix(path.relative(root, f)))
      .filter((f) => f.endsWith(".spec.ts"));
  })();

  const testsByDir = new Map<string, string[]>();
  for (const relPath of allFiles) {
    const base = path.posix.basename(relPath);
    if (!isAnyTest(base)) continue;
    const dir = path.posix.dirname(relPath);
    const list = testsByDir.get(dir) ?? [];
    list.push(relPath);
    testsByDir.set(dir, list);
  }

  const rows = features.map((feature) => {
    const coverage = findCoverage(feature, testsByDir);
    const evidence = classifyEvidence(feature, coverage);
    return { feature, coverage, evidence };
  });

  console.log("\nservice-desk TDD/BDD audit\n");
  console.log(
    "Checks whether a test exists next to each feature file, and whether git\n" +
      "history shows that test landing at or before the code it covers. See\n" +
      "docs/TESTING.md for the policy this checks against.\n",
  );

  // --- Coverage by category ---
  console.log(
    "-- Coverage --------------------------------------------------------------\n",
  );
  const categories: Array<{ key: Category; label: string }> = [
    { key: "lib", label: "src/lib        (business logic)" },
    { key: "api-route", label: "src/app/api    (route handlers)" },
    { key: "component", label: "src/components (UI components)" },
  ];
  const untested: string[] = [];
  for (const { key, label } of categories) {
    const inCat = rows.filter((r) => r.feature.category === key);
    const tested = inCat.filter((r) => r.coverage.kind !== "none");
    const direct = inCat.filter((r) => r.coverage.kind === "direct").length;
    const grouped = inCat.filter((r) => r.coverage.kind === "grouped").length;
    console.log(
      `  ${label}  ${tested.length}/${inCat.length} tested  (${direct} direct, ${grouped} grouped)`,
    );
    for (const r of inCat) {
      if (r.coverage.kind === "none") untested.push(r.feature.relPath);
    }
  }
  if (untested.length > 0) {
    console.log(`\n  No test found for ${untested.length} file(s):`);
    for (const f of untested) console.log(`    - ${f}`);
  }

  // --- Git evidence ---
  console.log(
    "\n-- Git evidence: did the test land at/before the code? -------------------\n",
  );
  const paired = rows.filter((r) => r.evidence.kind === "paired");
  const testFirst = rows.filter((r) => r.evidence.kind === "test-first");
  const testAfter = rows.filter((r) => r.evidence.kind === "test-after");
  const unversioned = rows.filter((r) => r.evidence.kind === "unversioned");
  const noTest = rows.filter((r) => r.evidence.kind === "no-test");

  console.log(`  Paired (same commit as the code):        ${paired.length}`);
  console.log(`  Test-first (earlier, separate commit):   ${testFirst.length}`);
  console.log(`  Test-after (later, separate commit):     ${testAfter.length}`);
  console.log(`  Unversioned (not committed yet):         ${unversioned.length}`);
  console.log(`  No test to compare:                      ${noTest.length}`);

  if (testAfter.length > 0) {
    console.log(`\n  Test-after -- worth a second look, not necessarily a problem:`);
    for (const r of testAfter) {
      const e = r.evidence as Extract<Evidence, { kind: "test-after" }>;
      console.log(
        `    - ${r.feature.relPath}\n` +
          `        code ${e.feature.sha.slice(0, 8)}  ${e.feature.date}\n` +
          `        test ${e.test.sha.slice(0, 8)}  ${e.test.date}`,
      );
    }
  }

  // --- BDD DSL adoption ---
  console.log(
    "\n-- BDD DSL adoption (Given/When/Then via src/test/bdd.ts) ----------------\n",
  );
  const unitTestFiles = allFiles.filter((f) => isUnitTest(path.posix.basename(f)));
  const bddFiles = unitTestFiles.filter(usesBddDsl);
  console.log(
    `  ${bddFiles.length}/${unitTestFiles.length} unit test files use the Given/When/Then DSL`,
  );
  const notBdd = unitTestFiles.filter((f) => !bddFiles.includes(f));
  if (notBdd.length > 0) {
    console.log(`\n  Plain describe/it, no BDD DSL:`);
    for (const f of notBdd) console.log(`    - ${f}`);
  }

  // --- Context, not scored ---
  console.log(
    "\n-- For context (not scored) ------------------------------------------------\n",
  );
  console.log(
    `  Framework entry points (page.tsx, layout.tsx, ...): ${frameworkEntryPoints.length}` +
      ` -- exercised by the e2e suite, not unit-tested per file.`,
  );
  console.log(
    `  E2E specs in e2e/*.spec.ts: ${e2eSpecs.length}` +
      ` -- plain Playwright test(), not BDD-styled, by this repo's convention.`,
  );

  // --- Summary ---
  const withHistory = paired.length + testFirst.length + testAfter.length;
  console.log(
    "\n-- Summary -----------------------------------------------------------------\n",
  );
  console.log(
    `  Feature coverage:                 ${pct(features.length - untested.length, features.length)}  (${features.length - untested.length}/${features.length})`,
  );
  console.log(
    `  Consistent with test-first order: ${pct(paired.length + testFirst.length, withHistory)}  (${paired.length + testFirst.length}/${withHistory} with usable git history)`,
  );
  console.log(
    `  BDD DSL adoption (unit suite):    ${pct(bddFiles.length, unitTestFiles.length)}  (${bddFiles.length}/${unitTestFiles.length})`,
  );
  console.log(
    "\nThis is evidence from file layout and commit order, not a build gate --\n" +
      "nothing above fails CI or this command. Read the test-after and no-test\n" +
      "lists before trusting a coverage number on its own.\n",
  );
}

main();
