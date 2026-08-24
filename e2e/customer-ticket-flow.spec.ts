import { test, expect } from "@playwright/test";
import { signInAsDevIdentity, DEV_IDENTITIES } from "./dev-auth";

/**
 * Journey 1 (Section 17): Customer signs in, searches knowledge, submits a
 * ticket with a screenshot and project number, and sees it in their
 * dashboard.
 */
test("customer submits a ticket and sees it on their dashboard", async ({ page }) => {
  await signInAsDevIdentity(page, DEV_IDENTITIES.customer);

  // Unique per run. This spec creates a ticket every time and nothing cleans
  // up, so a fixed subject means the second run sees two matches and the
  // assertions below fail strict mode instead of testing anything.
  const subject = `VPN client keeps disconnecting (${Date.now()})`;

  await page.goto("/tickets/new");

  await page.getByLabel("Subject").fill(subject);
  await page
    .getByLabel("Describe the issue")
    .fill(
      "My VPN client disconnects every few minutes when I switch between Wi-Fi networks during the day.",
    );

  // Knowledge suggestions should appear after typing (debounced).
  await expect(page.getByText(/this might already be answered/i)).toBeVisible({
    timeout: 5000,
  });

  await page.getByLabel("Yes").check();
  await page.getByLabel("Project number").fill("2026-0199");

  await page.getByLabel(/issue urls/i).fill("https://intranet.example.test/status/vpn");

  await page.getByLabel(/i confirm this ticket does not contain/i).check();

  await page.getByRole("button", { name: /submit ticket/i }).click();

  await page.waitForURL(/\/tickets\/SD-\d+/);
  await expect(page.getByRole("heading", { name: subject })).toBeVisible();

  // Attach a screenshot from the ticket detail page.
  await page.setInputFiles('input[type="file"]', {
    name: "screenshot.png",
    mimeType: "image/png",
    buffer: Buffer.from([
      0x89,
      0x50,
      0x4e,
      0x47,
      0x0d,
      0x0a,
      0x1a,
      0x0a,
      ...Array(64).fill(0),
    ]),
  });
  await page.getByRole("button", { name: /upload attachment/i }).click();
  // Upload round trip plus an RSC refresh; in dev mode under parallel workers
  // that regularly runs past the 5s default and is not a real failure.
  await expect(page.getByText("screenshot.png")).toBeVisible({ timeout: 30_000 });

  await page.goto("/dashboard");
  await expect(page.getByText(subject)).toBeVisible();
});
