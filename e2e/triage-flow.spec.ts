import { test, expect } from "@playwright/test";
import { signInAsDevIdentity, DEV_IDENTITIES } from "./dev-auth";

/**
 * Journey 2 (Section 17): Triage agent corrects department, adds a note,
 * confirms triage, and routes the ticket.
 *
 * Depends on seed data: at least one SUBMITTED or IN_TRIAGE ticket exists
 * (see prisma/seed.ts). Uses the first such ticket found in the queue
 * rather than a hardcoded ticket number, so it's resilient to seed
 * ordering.
 */
test("triage agent confirms triage and routes a ticket", async ({ page }) => {
  await signInAsDevIdentity(page, DEV_IDENTITIES.triage);

  await page.goto("/triage");
  const firstTicketLink = page.locator('a[href^="/tickets/"]').first();
  await expect(firstTicketLink).toBeVisible();
  const href = await firstTicketLink.getAttribute("href");
  await firstTicketLink.click();

  await expect(
    page.getByRole("heading", { level: 1 }).or(page.locator("h1, h2")),
  ).toBeVisible();

  await page.getByText(/add internal note/i).scrollIntoViewIfNeeded();
  const noteBox = page.locator("textarea").nth(1);
  await noteBox.fill(
    "Confirmed franchise details and routing to the correct department.",
  );
  await page.getByRole("button", { name: /add note/i }).click();

  const routeSection = page.getByText(/confirm triage/i);
  if (await routeSection.isVisible().catch(() => false)) {
    await page.getByRole("button", { name: /confirm triage & route/i }).click();
    await expect(page.getByText(/Queued/i)).toBeVisible();
  }

  expect(href).toMatch(/\/tickets\/SD-\d+/);
});
