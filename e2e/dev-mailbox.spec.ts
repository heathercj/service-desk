import { test, expect } from "@playwright/test";
import { signInAsDevIdentity, DEV_IDENTITIES } from "./dev-auth";

/**
 * Journey 7 (Section 17): the development mailbox accurately shows
 * captured rather than delivered email.
 */
test("development mailbox shows captured, not delivered, mail", async ({ page }) => {
  await signInAsDevIdentity(page, DEV_IDENTITIES.deptAgent);

  await page.goto("/queue/TECHNOLOGY_SUPPORT");
  await page.getByRole("link").first().click();

  const messageBox = page.locator("textarea").first();
  await messageBox.fill("Following up on this from the dev mailbox e2e test.");
  await page.getByRole("button", { name: /^send$/i }).click();

  await page.goto("/dev-mailbox");
  await expect(page.getByText(/captured locally.*not delivered/i)).toBeVisible();
  await expect(
    page.getByText("Following up on this from the dev mailbox e2e test."),
  ).toBeVisible();
  await expect(page.getByText("CAPTURED_DEV").first()).toBeVisible();
});
