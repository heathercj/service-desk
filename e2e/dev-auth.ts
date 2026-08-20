import type { Page } from "@playwright/test";

/**
 * Signs in as a seeded development identity (see
 * src/lib/dev-auth/dev-identities.ts). Requires ENABLE_DEV_AUTH=true and
 * `pnpm db:seed` to have been run against the target app.
 */
export async function signInAsDevIdentity(page: Page, displayNamePrefix: string) {
  await page.goto("/login");
  await page.getByRole("button", { name: new RegExp(displayNamePrefix) }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
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
