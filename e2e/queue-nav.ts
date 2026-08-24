import { expect, type Page } from "@playwright/test";

/**
 * Opens the first real ticket in a department queue.
 *
 * Specs used to do `getByRole("link").first()` here, which broke silently once
 * the queue grew its view-filter links ("Unassigned", "Resolved", ...): the
 * first link on the page became a filter, so the spec navigated to another
 * queue view and then failed further down on a missing textarea, never
 * reporting the real cause. Matching the href says what is actually wanted,
 * and the URL assertion makes a miss fail here with an obvious message.
 */
export async function openFirstTicketFromQueue(page: Page): Promise<void> {
  const ticketLink = page.locator('a[href^="/tickets/"]').first();
  await expect(ticketLink, "the queue should list at least one ticket").toBeVisible();
  await ticketLink.click();
  await page.waitForURL(/\/tickets\/[^/]+$/);
}
