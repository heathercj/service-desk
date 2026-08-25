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

/**
 * A department key that is not one of the five is a mistyped or stale link,
 * and the page has a notice for exactly that. It used to be a 500 instead:
 * the segment went to Prisma unnarrowed, and Prisma treats a value outside an
 * enum as a thrown PrismaClientValidationError rather than as no match -- so
 * the "Something went wrong" boundary answered for what is really a 404. See
 * `parseDepartmentKey` in src/lib/validation/ticket-schemas.ts.
 */
test("a department key outside the enum is a notice, not a server error", async ({
  page,
}) => {
  await signInAsDevIdentity(page, DEV_IDENTITIES.deptAgent);

  // Right department, wrong case -- the shape a hand-typed or copied URL takes.
  const res = await page.goto("/queue/technology_support");

  expect(res?.status(), "the queue page must not 500 on a bad key").toBeLessThan(500);
  await expect(page.getByText("Something went wrong")).toHaveCount(0);
  await expect(page.getByText(/Department not found or inactive/)).toBeVisible();
});
