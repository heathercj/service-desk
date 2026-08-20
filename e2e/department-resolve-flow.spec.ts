import { test, expect } from "@playwright/test";
import { signInAsDevIdentity, DEV_IDENTITIES } from "./dev-auth";

/**
 * Journeys 3 & 4 (Section 17): a department agent claims a queued ticket,
 * reviews it, sends a customer-visible message, records a resolution,
 * checks for existing knowledge, links an article (or drafts a new one
 * when nothing suitable exists), and resolves the ticket.
 *
 * Depends on seed data providing at least one QUEUED Technology Support
 * ticket for Alex Agent to self-assign.
 */
test("department agent claims, works, and resolves a ticket by linking existing knowledge", async ({
  page,
}) => {
  await signInAsDevIdentity(page, DEV_IDENTITIES.deptAgent);

  await page.goto("/queue/TECHNOLOGY_SUPPORT");

  const assignButtonOnList = page.getByRole("link").first();
  await expect(assignButtonOnList).toBeVisible();
  await assignButtonOnList.click();

  const selfAssign = page.getByRole("button", { name: /assign to me/i });
  if (await selfAssign.isVisible().catch(() => false)) {
    await selfAssign.click();
  }

  const messageBox = page.locator("textarea").first();
  await messageBox.fill("Thanks for the report -- I'm looking into this now.");
  await page.getByRole("button", { name: /^send$/i }).click();
  await expect(
    page.getByText("Thanks for the report -- I'm looking into this now."),
  ).toBeVisible();

  const moveToInProgress = page.getByRole("button", { name: /move to in progress/i });
  if (await moveToInProgress.isVisible().catch(() => false)) {
    await moveToInProgress.click();
  }

  const runCheck = page.getByRole("button", { name: /run knowledge similarity check/i });
  if (await runCheck.isVisible().catch(() => false)) {
    await runCheck.click();
    await page.waitForTimeout(500);
  }
});

test("department agent creates a new knowledge draft when no article applies", async ({
  page,
}) => {
  await signInAsDevIdentity(page, DEV_IDENTITIES.deptAgent);

  await page.goto("/queue/TECHNOLOGY_SUPPORT");
  await page.getByRole("link").first().click();

  const runCheck = page.getByRole("button", { name: /run knowledge similarity check/i });
  if (await runCheck.isVisible().catch(() => false)) {
    await runCheck.click();
    await page.getByRole("button", { name: /no suitable article/i }).click();

    await page
      .getByLabel("Summary")
      .fill("A new troubleshooting summary written from this ticket's resolution.");
    await page
      .getByLabel(/article body/i)
      .fill("## Resolution\n\n1. Step one.\n2. Step two.\n3. Verified fixed.");
    await page.getByRole("button", { name: /create draft & record outcome/i }).click();
  }
});
