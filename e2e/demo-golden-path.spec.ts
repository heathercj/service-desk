import { test, expect, type Page, type Browser } from "@playwright/test";
import { signInAsDevIdentity, DEV_IDENTITIES } from "./dev-auth";

/**
 * The demo walk: one ticket carried through all five beats of the golden
 * path, by the four people who actually touch it.
 *
 *   1. A customer submits an issue.
 *   2. Triage routes it; a department agent claims, works, and resolves it.
 *   3. Resolving it produces a draft knowledge article.
 *   4. A knowledge manager reviews and publishes that article.
 *   5. A second customer with the same problem is deflected by it -- no
 *      second ticket.
 *
 * Unlike the per-journey specs, nothing here is conditional. If a step
 * cannot happen, the walk fails: a demo that silently skips its own
 * middle is worse than a red test.
 *
 * Each actor gets their own browser context, so the hand-offs are real
 * sessions rather than one page swapping identities.
 *
 * Requires ENABLE_DEV_AUTH=true and `pnpm db:seed` against the target app.
 */

/**
 * A rare token planted in the subject, and therefore in the article title
 * drafted from it, so step 5's suggestion lookup finds THIS article rather
 * than something from the seed data.
 */
const RUN = `grommet${Date.now().toString(36)}`;
const SUBJECT = `Buildertrend ${RUN} change order will not submit`;
const SIMILAR_SUBJECT = `Cannot submit a ${RUN} change order in Buildertrend`;
const DESCRIPTION =
  `I was trying to submit a ${RUN} change order in Buildertrend, but clicking Submit ` +
  `does nothing at all. The page shows "Session expired" in the top corner and the ` +
  `change order stays in draft.`;

const RESOLUTION_SUMMARY = "Cleared the stale Buildertrend session and re-authenticated.";
const RESOLUTION_STEPS =
  "1. Signed the user out of Buildertrend. 2. Cleared cached credentials. " +
  "3. Signed back in and resubmitted the change order successfully.";
const ARTICLE_SUMMARY =
  `How to recover when a ${RUN} change order will not submit in Buildertrend because ` +
  `the session has expired.`;
const ARTICLE_BODY =
  "## Symptoms\n\nClicking Submit on a change order does nothing, and " +
  '"Session expired" appears in the top corner.\n\n' +
  "## Resolution\n\n1. Sign out of Buildertrend.\n2. Clear cached credentials.\n" +
  "3. Sign back in and resubmit the change order.";

/** Opens a fresh session as one dev identity. */
async function asIdentity(browser: Browser, identity: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signInAsDevIdentity(page, identity);
  return page;
}

/**
 * The guided tour (Henry) addresses the UI through `data-tour` attributes, and
 * this spec is the only thing that walks every state those anchors live in.
 * So it asserts them as it goes: a component refactor that drops an anchor
 * fails here rather than stranding the tour mid-demo.
 *
 * The unit test in src/lib/demo/tour-anchors.test.ts proves each anchor still
 * exists SOMEWHERE. These assertions prove it exists HERE, exactly once, on
 * the beat the tour expects it.
 */
async function expectAnchor(page: Page, anchor: string) {
  await expect(
    page.locator(`[data-tour="${anchor}"]`),
    `tour anchor "${anchor}" is missing or ambiguous`,
  ).toHaveCount(1);
}

/**
 * The same narrowing the tour does for repeated rows: find the row carrying
 * this text, then the anchor inside it. Without it, "click Publish" is
 * ambiguous the moment a second draft exists.
 */
async function expectScoped(page: Page, row: string, containing: string, anchor: string) {
  await expect(
    page
      .locator(`[data-tour="${row}"]`, { hasText: containing })
      .locator(`[data-tour="${anchor}"]`),
    `tour anchor "${anchor}" is not uniquely reachable inside "${row}"`,
  ).toHaveCount(1);
}

test.describe("Demo golden path", () => {
  // One continuous story: each step depends on the state the last one left.
  // Six sign-ins and a dozen server round-trips do not fit the default 30s,
  // and the first hit on each route pays for a dev-mode compile.
  test.describe.configure({ mode: "serial", timeout: 240_000 });

  test("an issue becomes a resolution, an article, and then a deflection", async ({
    browser,
  }) => {
    let ticketNumber = "";

    await test.step("1. The customer submits an issue", async () => {
      const page = await asIdentity(browser, DEV_IDENTITIES.customer);

      await page.goto("/tickets/new");
      await expectAnchor(page, "ticket-subject");
      await expectAnchor(page, "ticket-description");
      await expectAnchor(page, "ticket-consent");
      await expectAnchor(page, "ticket-submit");
      await page.getByLabel("Subject").fill(SUBJECT);
      await page.getByLabel("Describe the issue").fill(DESCRIPTION);
      await page.getByLabel(/i confirm this ticket does not contain/i).check();
      await page.getByRole("button", { name: /submit ticket/i }).click();

      await page.waitForURL(/\/tickets\/SD-\d+/);
      ticketNumber = new URL(page.url()).pathname.split("/").pop() ?? "";
      expect(ticketNumber).toMatch(/^SD-\d+$/);

      // The customer can see it, and it is waiting on the desk -- not
      // silently parked somewhere they cannot follow.
      await expect(page.getByText(SUBJECT)).toBeVisible();
      await expect(page.getByText("Submitted", { exact: true })).toBeVisible();
      await expectAnchor(page, "ticket-status");

      await page.goto("/dashboard");
      await expect(page.getByText(SUBJECT)).toBeVisible();
      await page.context().close();
    });

    await test.step("2a. Triage routes it to Technology Support", async () => {
      const page = await asIdentity(browser, DEV_IDENTITIES.triage);

      // It must be waiting in the triage queue, not merely reachable by URL.
      await page.goto("/triage");
      await expectScoped(page, "triage-row", ticketNumber, "ticket-link");
      await page.getByRole("link", { name: new RegExp(ticketNumber) }).click();
      await page.waitForURL(new RegExp(`/tickets/${ticketNumber}$`));

      await expectAnchor(page, "triage-confirm");
      await page
        .getByRole("button", { name: /confirm triage & route to Technology Support/i })
        .click();

      await expect(page.getByText("Queued", { exact: true })).toBeVisible();
      await page.context().close();
    });

    await test.step("2b. A department agent claims it and starts work", async () => {
      const page = await asIdentity(browser, DEV_IDENTITIES.deptAgent);
      // Claimed from the department queue, the way an agent would find it.
      await page.goto("/queue/TECHNOLOGY_SUPPORT");
      await expectScoped(page, "queue-row", ticketNumber, "ticket-link");
      await page.getByRole("link", { name: new RegExp(ticketNumber) }).click();
      await page.waitForURL(new RegExp(`/tickets/${ticketNumber}$`));

      await expectAnchor(page, "assign-self");
      await page.getByRole("button", { name: "Assign to me" }).click();
      await expect(page.getByText("Assigned", { exact: true })).toBeVisible();

      await expectAnchor(page, "transition-IN_PROGRESS");
      await page.getByRole("button", { name: /move to in progress/i }).click();
      await expect(page.getByText("In Progress", { exact: true })).toBeVisible();

      // A customer-visible reply, so the demo shows the conversation working.
      const reply =
        "Thanks for the detail -- I can see the expired session. Looking now.";
      const send = page.getByRole("button", { name: "Send", exact: true });
      // Addressed through its own Send button: several textareas live on this
      // page (note, resolution, knowledge draft), and "the first textbox" is
      // only stable until someone reorders the cards.
      const messageBox = send.locator("xpath=preceding-sibling::textarea");
      await expectAnchor(page, "message-body");
      await expectAnchor(page, "message-send");
      await messageBox.fill(reply);
      await send.click();

      // The box is cleared only after the POST resolves, so this is what
      // proves the reply was stored. Asserting the text alone passed on the
      // copy still sitting in the box -- which hid the request being
      // cancelled by the context closing below, and no message ever saved.
      await expect(messageBox).toHaveValue("");
      await expect(page.getByText(reply)).toBeVisible();
      await page.context().close();
    });

    await test.step("3. Resolving is gated until knowledge is dealt with", async () => {
      const page = await asIdentity(browser, DEV_IDENTITIES.deptAgent);
      await page.goto(`/tickets/${ticketNumber}`);

      await expectAnchor(page, "resolution-summary");
      await expectAnchor(page, "resolution-steps");
      await expectAnchor(page, "resolution-submit");
      await page.getByLabel("Resolution summary").fill(RESOLUTION_SUMMARY);
      await page.getByLabel("Resolution steps").fill(RESOLUTION_STEPS);
      await page.getByRole("button", { name: /submit resolution/i }).click();

      // The gate is the point of this beat: the ticket parks in review and
      // says exactly what is missing.
      await expect(page.getByText(/cannot resolve yet/i)).toBeVisible();
      await expectAnchor(page, "resolution-gate");
      // The blocking reason itself, not the button or the hint that also
      // mention a similarity check.
      await expect(
        page
          .getByRole("listitem")
          .filter({ hasText: /similarity check has not been completed/i }),
      ).toBeVisible();
      await expect(page.getByText("Resolution Review", { exact: true })).toBeVisible();
      await page.context().close();
    });

    await test.step("3b. The agent checks knowledge and drafts the missing article", async () => {
      const page = await asIdentity(browser, DEV_IDENTITIES.deptAgent);
      await page.goto(`/tickets/${ticketNumber}`);

      await expectAnchor(page, "knowledge-check-run");
      await page.getByRole("button", { name: /run knowledge similarity check/i }).click();

      // Nothing covers this yet -- that is why a draft is the right outcome.
      await expectAnchor(page, "knowledge-draft-toggle");
      await page
        .getByRole("button", { name: /no suitable article -- create a new draft/i })
        .click();

      await expect(page.getByLabel("Title", { exact: true })).toHaveValue(SUBJECT);
      await expectAnchor(page, "draft-summary");
      await expectAnchor(page, "draft-body");
      await expectAnchor(page, "draft-create");
      await page.getByLabel("Summary", { exact: true }).fill(ARTICLE_SUMMARY);
      await page.getByLabel(/article body/i).fill(ARTICLE_BODY);
      await page.getByRole("button", { name: /create draft & record outcome/i }).click();

      // Recording the outcome satisfies the last gate condition, so the
      // ticket resolves itself -- and says which article it came out of.
      await expect(page.getByText("Resolved", { exact: true })).toBeVisible();
      await expect(page.getByText(/New Draft: /)).toBeVisible();
      await page.context().close();
    });

    // Note: the management console publishes straight from DRAFT --
    // submitArticleForReview() is never on this path, so IN_REVIEW is not a
    // state the demo passes through today.
    await test.step("4. A knowledge manager reviews and publishes the article", async () => {
      const page = await asIdentity(browser, DEV_IDENTITIES.knowledgeManager);
      await page.goto("/knowledge/manage");

      // The draft is waiting under DRAFT, carrying the ticket's subject.
      // The card body is the row: it holds the title, the status badge, and
      // the actions together.
      const row = () =>
        page
          .getByRole("link", { name: SUBJECT })
          .locator("xpath=ancestor::div[contains(@class,'flex-wrap')][1]");

      await expect(row().getByText("DRAFT")).toBeVisible();
      await expectScoped(page, "article-row", SUBJECT, "article-publish");
      await row().getByRole("button", { name: "Publish" }).click();

      // Publishing moves it into the PUBLISHED section, and the publish
      // action goes away -- there is nothing left to approve.
      await expect(row().getByText("PUBLISHED")).toBeVisible();
      await expect(row().getByRole("button", { name: "Publish" })).toHaveCount(0);
      await page.context().close();
    });

    await test.step("5. A second customer with the same problem is deflected", async () => {
      const page = await asIdentity(browser, DEV_IDENTITIES.customer2);

      await page.goto("/tickets/new");
      await page.getByLabel("Subject").fill(SIMILAR_SUBJECT);
      await page.getByLabel("Describe the issue").fill(DESCRIPTION);

      // Suggestions are debounced; the published article must be among them.
      await expect(page.getByText(/this might already be answered/i)).toBeVisible({
        timeout: 10_000,
      });
      const suggestion = page.getByRole("link", { name: SUBJECT });
      await expect(suggestion).toBeVisible();
      await expectAnchor(page, "suggestions-card");
      await expectScoped(page, "suggestion-row", SUBJECT, "deflect-solved");

      await page
        .getByRole("button", { name: /this solved it/i })
        .first()
        .click();

      await expect(page.getByText(/glad that helped/i)).toBeVisible();
      await expectAnchor(page, "deflected-confirmation");
      await expect(page.getByText(/no ticket was created/i)).toBeVisible();

      // And the deflection really did prevent a ticket.
      await page.goto("/dashboard");
      await expect(page.getByText(SIMILAR_SUBJECT)).toHaveCount(0);
      await page.context().close();
    });
  });
});
