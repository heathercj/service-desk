import { test, expect } from "@playwright/test";
import { signInAsDevIdentity, DEV_IDENTITIES } from "./dev-auth";

/**
 * Journeys 5 & 6 (Section 17): a customer cannot access another seeded
 * customer's ticket by changing a URL identifier, and an unauthorized
 * department agent receives a safe forbidden response rather than a
 * server error or someone else's data.
 */
test("customer cannot view another customer's ticket by editing the URL", async ({
  page,
}) => {
  await signInAsDevIdentity(page, DEV_IDENTITIES.customer);
  await page.goto("/dashboard");

  const ownTicketLink = page.locator('a[href^="/tickets/SD-"]').first();
  await expect(ownTicketLink).toBeVisible();

  await signInAsDevIdentity(page, DEV_IDENTITIES.customer2);
  await page.goto("/dashboard");
  const otherOwnTicketLink = page.locator('a[href^="/tickets/SD-"]').first();
  await expect(otherOwnTicketLink).toBeVisible();
  const otherHref = await otherOwnTicketLink.getAttribute("href");

  // Now sign back in as the first customer and try to open the second
  // customer's ticket directly.
  await signInAsDevIdentity(page, DEV_IDENTITIES.customer);
  await page.goto(otherHref!);

  await expect(
    page.getByText(/access denied|don't have permission|not found/i),
  ).toBeVisible();
});

test("an agent outside the ticket's department gets a safe forbidden response", async ({
  page,
}) => {
  await signInAsDevIdentity(page, DEV_IDENTITIES.deptAgent); // Technology Support only

  // Attempt to view the Accounting Services department queue directly.
  await page.goto("/queue/ACCOUNTING_SERVICES");
  await expect(page.getByText(/access denied|not authorized|forbidden/i)).toBeVisible();
});
