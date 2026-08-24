import { expect, type Page } from "@playwright/test";

/**
 * Opens a specific ticket in a department queue, by the subject the seed gave
 * it.
 *
 * Matching on the href rather than on "the first link" is deliberate: specs
 * used to do `getByRole("link").first()`, which broke silently once the queue
 * grew its view-filter links ("Unassigned", "Resolved", ...) -- the spec
 * navigated to another queue view and then failed further down on a missing
 * textarea, never reporting the real cause.
 *
 * Two specs in this suite work a ticket from the same queue, and taking "the
 * first one" put them both on the same ticket: the queue has a deterministic
 * order, so both landed on it, and one test's in-flight write left every
 * control on the page disabled while the other was trying to type into it.
 * Naming the ticket is what keeps two tests that run at the same time out of
 * each other's way.
 */
export async function openQueueTicketBySubject(
  page: Page,
  subject: string,
): Promise<void> {
  const ticketLink = page.locator('a[href^="/tickets/"]', { hasText: subject }).first();
  await expect(
    ticketLink,
    `the queue should list a ticket whose subject contains "${subject}"`,
  ).toBeVisible();
  await ticketLink.click();
  await page.waitForURL(/\/tickets\/[^/]+$/);
}
