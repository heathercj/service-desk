import { test, expect } from "@playwright/test";
import { signInAsDevIdentity, DEV_IDENTITIES } from "./dev-auth";
import { openFirstTicketFromQueue } from "./queue-nav";

/**
 * Journey 7 (Section 17): the development mailbox accurately shows
 * captured rather than delivered email.
 */
test("development mailbox shows captured, not delivered, mail", async ({ page }) => {
  await signInAsDevIdentity(page, DEV_IDENTITIES.deptAgent);

  await page.goto("/queue/TECHNOLOGY_SUPPORT");
  await openFirstTicketFromQueue(page);

  // Unique per run. The old fixed string matched mail captured by *earlier*
  // runs, so the assertion below would have passed even if this run's message
  // was never sent -- and OutboundEmail rows are never cleaned up.
  const reply = `Following up from the dev mailbox e2e test (${Date.now()}).`;

  const send = page.getByRole("button", { name: /^send$/i });
  const messageBox = send.locator("xpath=preceding-sibling::textarea");
  await messageBox.fill(reply);
  await send.click();
  // The box clears only once the POST resolves. Navigating straight to
  // /dev-mailbox raced the in-flight request and cancelled it, which is why
  // this spec reported the mail as missing.
  await expect(messageBox).toHaveValue("");

  await page.goto("/dev-mailbox");
  await expect(page.getByText(/captured locally.*not delivered/i)).toBeVisible();
  await expect(page.getByText(reply)).toBeVisible();
  await expect(page.getByText("CAPTURED_DEV").first()).toBeVisible();
});
