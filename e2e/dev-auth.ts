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
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), {
    waitUntil: "commit",
  });
}

export const DEV_IDENTITIES = {
  customer: "Casey Customer",
  customer2: "Jordan Second-Customer",
  triage: "Taylor Triage",
  deptAgent: "Alex Agent",
  deptManager: "Morgan Manager",
  knowledgeManager: "Kai Knowledge",
  admin: "Robin Admin",
} as const;
