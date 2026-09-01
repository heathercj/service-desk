import { test, expect } from "@playwright/test";
import { signInAsDevIdentity, DEV_IDENTITIES } from "./dev-auth";

/**
 * A department manager's team report is scoped to the department(s)
 * they actually manage -- not every department in the system. Morgan
 * Manager manages Technology Support and Training only (see
 * src/lib/dev-auth/dev-identities.ts), so this also exercises the
 * multi-department picker at /reports/team.
 */
test("a manager sees only their own departments' team reports", async ({ page }) => {
  await signInAsDevIdentity(page, DEV_IDENTITIES.deptManager);
  await page.goto("/reports/team");

  await expect(page.getByRole("link", { name: "Technology Support" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Training" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Legal" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Marketing" })).toHaveCount(0);

  await page.getByRole("link", { name: "Technology Support" }).click();
  await expect(
    page.getByRole("heading", { name: /technology support team report/i }),
  ).toBeVisible();
  await expect(page.getByText(/agent/i).first()).toBeVisible();
});

test("a department agent with no manager membership cannot reach the team report directly", async ({
  page,
}) => {
  await signInAsDevIdentity(page, DEV_IDENTITIES.deptAgent); // Alex Agent -- agent, not manager
  const res = await page.goto("/reports/team/TECHNOLOGY_SUPPORT");

  expect(res?.status(), "must not 500 on an unauthorized report request").toBeLessThan(
    500,
  );
  await expect(page.getByText(/access denied|not authorized|forbidden/i)).toBeVisible();
});

test("a knowledge manager can view the knowledge base health report", async ({
  page,
}) => {
  await signInAsDevIdentity(page, DEV_IDENTITIES.knowledgeManager);
  await page.goto("/reports/knowledge");

  await expect(
    page.getByRole("heading", { name: /knowledge base health/i }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Needs review" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Unused" })).toBeVisible();
});

test("a product manager can view the product-signals report", async ({ page }) => {
  await signInAsDevIdentity(page, DEV_IDENTITIES.productManager);
  await page.goto("/reports/product");

  await expect(page.getByRole("heading", { name: /product signals/i })).toBeVisible();
  await expect(page.getByRole("link", { name: "Improvement ideas" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Slow to resolve" })).toBeVisible();
});

test("a department agent cannot reach the product-signals report directly", async ({
  page,
}) => {
  await signInAsDevIdentity(page, DEV_IDENTITIES.deptAgent);
  const res = await page.goto("/reports/product");

  expect(res?.status(), "must not 500 on an unauthorized report request").toBeLessThan(
    500,
  );
  await expect(page.getByText(/access denied|not authorized|forbidden/i)).toBeVisible();
});
