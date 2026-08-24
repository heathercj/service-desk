/**
 * Launches the standalone production build for the e2e suite, with
 * development authentication enabled.
 *
 * Why this exists rather than `next start` or the generated
 * `.next/standalone/server.js`:
 *
 * The suite's problem is that `next dev` compiles each route on first hit,
 * and every spec signs in through the dev identity picker. Under full
 * parallelism, six workers arrive at once and the sign-in POST comes back to
 * /login instead of through it -- see "Known flake" in docs/TESTING.md. A
 * prebuilt server has no compile step, so the race has nothing to lose.
 *
 * But a prebuilt server has to run with dev auth, and src/lib/env.ts refuses
 * to start with ENABLE_DEV_AUTH=true when NODE_ENV=production -- deliberately,
 * it is a hard security guard. `next start` hard-sets production, and so does
 * the generated `server.js`, on its fifth line, before anything else loads.
 * That is why NODE_ENV=test in .github/workflows/dast.yml has no effect: the
 * generated launcher overwrites it and every request 500s out of middleware.
 *
 * So this file is that launcher without the overwrite. It is a deliberate
 * transcription of the generated server.js, minus one line, and reads the
 * config from required-server-files.json rather than the copy Next inlines.
 * The guard in env.ts is untouched: NODE_ENV really is `test` here, and this
 * script refuses to run under `production` so it can never become the way
 * dev auth reaches a real deployment.
 *
 * It also does not chdir into the standalone directory the way the generated
 * launcher does. Two things resolve against process.cwd() --
 * KNOWLEDGE_BASE_ROOT in src/lib/knowledge/markdown-repo.ts and the default
 * OBJECT_STORAGE_ROOT -- so a chdir would publish the suite's articles into
 * .next/standalone/knowledge-base, where `pnpm demo:clean` and
 * `pnpm kb:validate` would never find them. Staying at the repo root makes the
 * prebuilt server write exactly where `next dev` writes.
 */
import { createRequire } from "node:module";
import { cpSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const standaloneDir = path.join(repoRoot, ".next", "standalone");

function fail(message: string): never {
  console.error(`e2e-server: ${message}`);
  process.exit(1);
}

if (process.env.NODE_ENV === "production") {
  fail(
    "refusing to start under NODE_ENV=production. This launcher exists to run a " +
      "production build with development authentication, which must never happen " +
      "in production -- see the guard in src/lib/env.ts.",
  );
}
// Next's types mark NODE_ENV read-only, which is right for app code and wrong
// for a launcher -- deciding NODE_ENV is this file's whole job.
(process.env as Record<string, string | undefined>).NODE_ENV ??= "test";

if (!existsSync(path.join(standaloneDir, ".next"))) {
  fail(
    "no standalone build found. Build one first:\n" +
      "  ENABLE_DEV_AUTH=false pnpm build",
  );
}

// `output: "standalone"` does not copy the client bundles -- Next expects the
// deployment to serve .next/static itself. Without this the pages load and
// then sit there unhydrated, every asset a 404, which looks like a broken app
// rather than a missing copy step.
const staticSrc = path.join(repoRoot, ".next", "static");
if (!existsSync(staticSrc)) {
  fail(".next/static is missing, so the build is incomplete. Re-run the build.");
}
cpSync(staticSrc, path.join(standaloneDir, ".next", "static"), { recursive: true });

const requiredServerFiles = path.join(
  standaloneDir,
  ".next",
  "required-server-files.json",
);
const { config } = JSON.parse(readFileSync(requiredServerFiles, "utf8")) as {
  config: Record<string, unknown>;
};

process.env.__NEXT_PRIVATE_STANDALONE_CONFIG = JSON.stringify(config);

const port = Number.parseInt(process.env.PORT ?? "", 10) || 3000;
const hostname = process.env.HOSTNAME || "0.0.0.0";

// Resolved from inside the standalone tree: that is where the build's own
// pruned node_modules lives, and it is the copy of Next the build was made by.
const requireFromStandalone = createRequire(path.join(standaloneDir, "server.js"));
requireFromStandalone("next");
const { startServer } = requireFromStandalone("next/dist/server/lib/start-server") as {
  startServer: (opts: {
    dir: string;
    isDev: boolean;
    config: Record<string, unknown>;
    hostname: string;
    port: number;
    allowRetry: boolean;
  }) => Promise<void>;
};

startServer({
  dir: standaloneDir,
  isDev: false,
  config,
  hostname,
  port,
  allowRetry: false,
}).catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
