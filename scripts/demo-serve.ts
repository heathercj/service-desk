import "dotenv/config";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

/**
 * Serves the demo off a PREBUILT app, so nothing is compiled while a room is
 * watching.
 *
 *   pnpm demo:prep && pnpm demo:build && pnpm demo:serve
 *
 * Why not `pnpm dev`, which is what the README said to present from:
 *
 * `next dev` compiles each route the first time it is hit. Every route in the
 * tour is therefore compiled DURING the walk, and the compile lands at the
 * least forgiving moment -- the identity handoffs are full page navigations
 * out of a sign-in POST, so the first hit of `/queue/TECHNOLOGY_SUPPORT`
 * happens mid-redirect, on the beat where Alex meets his team's queue. This
 * repo already knows that first-hit compiles are its flakiest surface: the
 * e2e timeouts are set to 90s for it (playwright.config.ts), "Known flake" in
 * docs/TESTING.md is it, and scripts/e2e-server.ts exists because of it.
 * A prebuilt server has no compile step, so none of that can happen live.
 *
 * It also removes a foot-gun that only bites during a demo: a `next build`
 * (or `pnpm test:e2e:built`, or `pnpm ci:local`) run while `pnpm dev` is
 * serving overwrites the .next the dev server is reading, and the symptom is
 * a "Something went wrong" boundary on the next route that server tries to
 * compile -- i.e. on the next new page of the walk, not on the page anyone
 * touched. Presenting from the build means the build is the artefact, and
 * rebuilding is a deliberate step you take between walks, not something that
 * can happen underneath one.
 *
 * The launcher itself is scripts/e2e-server.ts -- see the long note there for
 * why neither `next start` nor Next's generated server.js can run a
 * production build with development authentication.
 */

const repoRoot = process.cwd();

function fail(message: string): never {
  console.error(`\ndemo:serve: ${message}\n`);
  process.exit(1);
}

if (process.env.NODE_ENV === "production") {
  fail(
    "refusing to start under NODE_ENV=production. The demo runs as seeded " +
      "development identities, which src/lib/env.ts forbids in production.",
  );
}

if (!existsSync(path.join(repoRoot, ".next", "standalone", ".next"))) {
  fail(
    "no build to serve. Run `pnpm demo:build` first.\n\n" +
      "  If you did build: `next dev` rewrites .next when it starts, which " +
      "removes\n" +
      "  the standalone build from underneath this launcher. The two share one\n" +
      "  .next and whichever started last wins -- so stop `pnpm dev` before\n" +
      "  building the demo, and build again if it has run since.",
  );
}

/**
 * Sign-ins are the tour's mechanism, not an attack: it hands the ticket
 * between five identities, so one walk is five sign-ins from one IP -- and
 * localhost sends no x-forwarded-for, so middleware puts every caller in the
 * single bucket `auth:unknown` (see the note in src/lib/env.ts). Twenty a
 * minute is right for humans and wrong for a rehearsal followed by the real
 * walk, where the twenty-first sign-in comes back 429 and the tour strands on
 * a handoff card.
 *
 * Raised only here, in a launcher that already refuses to run anywhere but a
 * local machine with development authentication on. The default in
 * src/lib/env.ts -- the one every real deployment gets -- is untouched.
 */
const env: NodeJS.ProcessEnv = {
  ...process.env,
  NODE_ENV: "test",
  ENABLE_DEV_AUTH: "true",
  ENABLE_DEMO_TOUR: "true",
  RATE_LIMIT_AUTH_MAX: process.env.RATE_LIMIT_AUTH_MAX ?? "200",
};

const port = process.env.PORT ?? "3000";
console.log(
  `Serving the prebuilt demo on http://localhost:${port}\n` +
    `  dev auth: on   guided tour: on   compiled: ahead of time\n` +
    `  Rebuild after a code change: pnpm demo:build\n`,
);

try {
  execFileSync("pnpm", ["exec", "tsx", "scripts/e2e-server.ts"], {
    stdio: "inherit",
    env,
  });
} catch {
  // execFileSync throws on a non-zero exit AND on the Ctrl-C that stops a
  // server on purpose. Either way e2e-server.ts has already said what
  // happened, so adding a stack trace here only buries it.
  process.exit(1);
}
