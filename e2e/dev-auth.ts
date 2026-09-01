import type { Page } from "@playwright/test";

/**
 * Signs in as a seeded development identity (see
 * src/lib/dev-auth/dev-identities.ts). Requires ENABLE_DEV_AUTH=true and
 * `pnpm db:seed` to have been run against the target app.
 */
export async function signInAsDevIdentity(page: Page, displayNamePrefix: string) {
  await page.goto("/login");
  await page.getByRole("button", { name: new RegExp(displayNamePrefix) }).click();
  // `commit`, not the default `load`: all this step needs to know is that the
  // sign-in navigation left /login. Waiting for `load` made every spec that
  // switches identity mid-test flaky under parallel workers -- the dev server
  // compiles routes on demand, so the page had reached /dashboard while its
  // load event was still tens of seconds away. Callers do their own
  // `goto`/assertion afterwards, which waits properly.
  try {
    await page.waitForURL((url) => !url.pathname.startsWith("/login"), {
      waitUntil: "commit",
    });
  } catch (cause) {
    // This timeout used to be the whole symptom of the suite's long-running
    // flake, and it says nothing about why. Name the likely cause instead:
    // the sign-in limit shares one bucket across every caller without an
    // x-forwarded-for, so a full-width run can exhaust it and next-auth just
    // returns to /login. See "The flake that was not about `next dev`" in
    // docs/TESTING.md.
    throw new Error(
      `Sign-in as ${displayNamePrefix} never left /login (still at ${page.url()}).\n` +
        "If this is a full-suite run, suspect the sign-in rate limit before " +
        "anything else: middleware allows RATE_LIMIT_AUTH_MAX requests " +
        "(default 20) per window and keys them on x-forwarded-for, which " +
        "localhost does not send -- so all workers share one bucket and the " +
        "sign-in POST comes back 429. `pnpm test:e2e` raises the max; a bare " +
        "`playwright test` does not.",
      { cause },
    );
  }
}

export const DEV_IDENTITIES = {
  customer: "Casey Customer",
  customer2: "Jordan Second-Customer",
  triage: "Taylor Triage",
  deptAgent: "Alex Agent",
  deptManager: "Morgan Manager",
  knowledgeManager: "Kai Knowledge",
  admin: "Robin Admin",
  productManager: "Parker Product",
} as const;
