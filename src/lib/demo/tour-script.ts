/**
 * THE MANIFEST. The demo, as data.
 *
 * This mirrors e2e/demo-golden-path.spec.ts beat for beat, deliberately: the
 * spec proves the path still works in CI, and this narrates the same path to
 * a room. Keeping them in step is what the anchor test is for.
 *
 * Audience is the internal tech team, so narration names the enforcement
 * point rather than the benefit. They will read every line as a claim and
 * then try to break it -- which is the point, and the reason nothing here
 * overstates what the app does.
 */

import type { TourBeat, TourContext } from "./tour-types";

const TECH_SUPPORT_QUEUE = "/queue/TECHNOLOGY_SUPPORT";

/**
 * A fresh run token per tour, so consecutive demos never collide and the
 * final beat's lookup cannot match a previous run's article. Same reason the
 * e2e spec does it.
 */
export function createTourContext(now: number = Date.now()): TourContext {
  const run = `henry${now.toString(36)}`;
  return {
    run,
    subject: `Buildertrend ${run} change order will not submit`,
    similarSubject: `Cannot submit a ${run} change order in Buildertrend`,
    description:
      `I was trying to submit a ${run} change order in Buildertrend, but clicking ` +
      `Submit does nothing at all. The page shows "Session expired" in the top ` +
      `corner and the change order stays in draft.`,
    reply: "Thanks for the detail -- I can see the expired session. Looking now.",
    resolutionSummary: "Cleared the stale Buildertrend session and re-authenticated.",
    resolutionSteps:
      "1. Signed the user out of Buildertrend. 2. Cleared cached credentials. " +
      "3. Signed back in and resubmitted the change order successfully.",
    articleSummary:
      `How to recover when a ${run} change order will not submit in Buildertrend ` +
      `because the session has expired.`,
    articleBody:
      "## Symptoms\n\nClicking Submit on a change order does nothing, and " +
      '"Session expired" appears in the top corner.\n\n' +
      "## Resolution\n\n1. Sign out of Buildertrend.\n2. Clear cached credentials.\n" +
      "3. Sign back in and resubmit the change order.",
  };
}

const ticketRoute = (ctx: TourContext) => `/tickets/${ctx.ticketNumber}`;

export const TOUR: TourBeat[] = [
  {
    id: "intake",
    title: "Intake",
    premise: "A franchise partner reports a problem, and validation is not cosmetic.",
    steps: [
      {
        id: "intake-intro",
        as: "customer",
        route: "/tickets/new",
        say:
          "We start as Casey Customer -- a franchise partner with no staff rights at " +
          "all. This form posts to /api/tickets, and the zod schema it validates " +
          "against is the same module the client uses. The browser checks are a " +
          "courtesy; the server is the authority.",
        advance: { kind: "read" },
      },
      {
        id: "intake-subject",
        as: "customer",
        route: "/tickets/new",
        say:
          "The subject carries a one-off run token. That is not decoration -- the " +
          "last beat searches for it, so this demo can never accidentally match an " +
          "article from a previous run.",
        cue: "Type a subject, or let me fill it in.",
        anchor: "ticket-subject",
        advance: { kind: "filled", anchor: "ticket-subject" },
        perform: (ctx, dom) => dom.type("ticket-subject", ctx.subject),
      },
      {
        id: "intake-description",
        as: "customer",
        route: "/tickets/new",
        say:
          "Watch the description field: every keystroke restarts a 500ms debounce " +
          "that queries /api/knowledge/suggestions. Nothing matches yet, because " +
          "the article that answers this does not exist. We are about to write it.",
        cue: "Describe the issue.",
        anchor: "ticket-description",
        advance: { kind: "filled", anchor: "ticket-description" },
        perform: (ctx, dom) => dom.type("ticket-description", ctx.description),
      },
      {
        id: "intake-consent",
        as: "customer",
        route: "/tickets/new",
        say:
          "The no-secrets acknowledgement is a required boolean in the schema, so a " +
          "crafted POST that omits it is rejected too. It is not just a checkbox " +
          "guarding a button.",
        cue: "Tick the acknowledgement.",
        anchor: "ticket-consent",
        advance: { kind: "checked", anchor: "ticket-consent" },
        perform: (_ctx, dom) => dom.check("ticket-consent"),
      },
      {
        id: "intake-submit",
        as: "customer",
        route: "/tickets/new",
        say:
          "Submitting mints an SD- number and auto-routes the ticket to a department " +
          "-- the customer is never asked to guess which team owns their problem.",
        cue: "Submit the ticket.",
        anchor: "ticket-submit",
        advance: { kind: "route", pattern: /^\/tickets\/SD-\d+$/ },
        capture: (loc) => ({ ticketNumber: loc.pathname.split("/").pop() }),
        perform: (_ctx, dom) => dom.click("ticket-submit"),
      },
    ],
  },
  {
    id: "triage",
    title: "Triage",
    premise: "Routing is suggested by the system and confirmed by a human.",
    steps: [
      {
        id: "triage-handoff",
        as: "triage",
        route: "/triage",
        say:
          "I have signed you in as Taylor Triage. Look at the nav: it changed. Link " +
          "visibility is derived from roles, and every route re-checks server-side " +
          "-- typing /triage as Casey gets you a refusal, not a blank page.",
        advance: { kind: "read" },
      },
      {
        id: "triage-open",
        as: "triage",
        route: "/triage",
        say:
          "The ticket is waiting here because it was routed, not because we know its " +
          "URL. That distinction is the whole reason the e2e spec opens it from the " +
          "queue rather than navigating directly.",
        cue: (ctx) => `Open ${ctx.ticketNumber}.`,
        anchor: "ticket-link",
        within: { anchor: "triage-row", containing: (ctx) => ctx.ticketNumber ?? "" },
        advance: { kind: "route", pattern: /^\/tickets\/SD-\d+$/ },
        perform: (ctx, dom) =>
          dom.click("ticket-link", {
            anchor: "triage-row",
            containing: ctx.ticketNumber ?? "",
          }),
      },
      {
        id: "triage-confirm",
        as: "triage",
        route: ticketRoute,
        say:
          "Auto-routing already proposed Technology Support. A human still confirms " +
          "it, and the confirmation lands in the audit trail with Taylor's name on " +
          "it. The status will move to Queued.",
        cue: "Confirm the route.",
        anchor: "triage-confirm",
        advance: { kind: "text", pattern: /^Queued$/, within: "ticket-status" },
        perform: (_ctx, dom) => dom.click("triage-confirm"),
      },
    ],
  },
  {
    id: "work",
    title: "The work",
    premise: "Department scoping is RBAC, and the conversation is real.",
    steps: [
      {
        id: "work-handoff",
        as: "dept-agent",
        route: TECH_SUPPORT_QUEUE,
        say:
          "Now Alex Agent, Technology Support. Worth trying after the demo: sign in " +
          "as Priya in Accounting Services and load this exact URL. You get a refusal " +
          "-- queue membership is enforced in listDepartmentQueue, not hidden in the nav.",
        advance: { kind: "read" },
      },
      {
        id: "work-open",
        as: "dept-agent",
        route: TECH_SUPPORT_QUEUE,
        say: "Unassigned, sitting in the department queue, waiting for someone to own it.",
        cue: (ctx) => `Open ${ctx.ticketNumber}.`,
        anchor: "ticket-link",
        within: { anchor: "queue-row", containing: (ctx) => ctx.ticketNumber ?? "" },
        advance: { kind: "route", pattern: /^\/tickets\/SD-\d+$/ },
        perform: (ctx, dom) =>
          dom.click("ticket-link", {
            anchor: "queue-row",
            containing: ctx.ticketNumber ?? "",
          }),
      },
      {
        id: "work-claim",
        as: "dept-agent",
        route: ticketRoute,
        say:
          "Claiming it posts to /assign-self with the ticket's version number. Two " +
          "agents racing for the same ticket is an optimistic-concurrency conflict, " +
          "not a last-write-wins surprise.",
        cue: "Claim the ticket.",
        anchor: "assign-self",
        advance: { kind: "text", pattern: /^Assigned$/, within: "ticket-status" },
        perform: (_ctx, dom) => dom.click("assign-self"),
      },
      {
        id: "work-progress",
        as: "dept-agent",
        route: ticketRoute,
        say:
          "Only the transitions the state machine permits from here are rendered as " +
          "buttons -- the list comes from allowedNextStatuses, so the UI cannot offer " +
          "an illegal move.",
        cue: "Move it to In Progress.",
        anchor: "transition-IN_PROGRESS",
        advance: { kind: "text", pattern: /^In Progress$/, within: "ticket-status" },
        perform: (_ctx, dom) => dom.click("transition-IN_PROGRESS"),
      },
      {
        id: "work-reply",
        as: "dept-agent",
        route: ticketRoute,
        say:
          "This box is customer-visible. Internal notes are a separate control below " +
          "it, and customers never see those -- the split is enforced at the API, " +
          "which is why they are two endpoints and not one with a flag.",
        cue: "Write a reply.",
        anchor: "message-body",
        advance: { kind: "filled", anchor: "message-body" },
        perform: (ctx, dom) => dom.type("message-body", ctx.reply),
      },
      {
        id: "work-send",
        as: "dept-agent",
        route: ticketRoute,
        say:
          "I wait for the box to CLEAR, not for the text to appear on screen. The " +
          "e2e spec learned that the hard way: asserting the text was visible passed " +
          "against the copy still sitting in the textarea, while the POST had been " +
          "cancelled and nothing was ever saved.",
        cue: "Send it.",
        anchor: "message-send",
        advance: { kind: "emptied", anchor: "message-body" },
        perform: (_ctx, dom) => dom.click("message-send"),
      },
    ],
  },
  {
    id: "gate",
    title: "The gate",
    premise: "You cannot resolve a ticket without dealing with knowledge. Server-side.",
    steps: [
      {
        id: "gate-summary",
        as: "dept-agent",
        route: ticketRoute,
        say: "Alex has fixed it. Now watch what happens when he tries to close it out.",
        cue: "Fill in the resolution summary.",
        anchor: "resolution-summary",
        advance: { kind: "filled", anchor: "resolution-summary" },
        perform: (ctx, dom) => dom.type("resolution-summary", ctx.resolutionSummary),
      },
      {
        id: "gate-steps",
        as: "dept-agent",
        route: ticketRoute,
        say: "And what he actually did, which is what the article will be drafted from.",
        cue: "Fill in the resolution steps.",
        anchor: "resolution-steps",
        advance: { kind: "filled", anchor: "resolution-steps" },
        perform: (ctx, dom) => dom.type("resolution-steps", ctx.resolutionSteps),
      },
      {
        id: "gate-blocked",
        as: "dept-agent",
        route: ticketRoute,
        say:
          "Refused. The ticket parks in Resolution Review and tells him exactly what " +
          "is missing: the similarity check has not been run.",
        cue: "Submit the resolution.",
        anchor: "resolution-submit",
        advance: { kind: "appears", anchor: "resolution-gate" },
        perform: (_ctx, dom) => dom.click("resolution-submit"),
      },
      {
        id: "gate-explain",
        as: "dept-agent",
        route: ticketRoute,
        say:
          "This is the beat worth arguing with. The gate is evaluated in " +
          "ticket-service.ts on the way through /api/tickets/:id/resolve -- so curl " +
          "the endpoint directly and it refuses you the same way. The disabled button " +
          "is a convenience, not the control. Try it after the demo.",
        advance: { kind: "read" },
      },
    ],
  },
  {
    id: "knowledge",
    title: "Knowledge",
    premise: "Resolving a novel problem produces a draft article as a side effect.",
    steps: [
      {
        id: "kb-check",
        as: "dept-agent",
        route: ticketRoute,
        say:
          "The check is deterministic full-text search over existing articles -- " +
          "Postgres, not a model. It returns nothing, which is the honest answer: " +
          "this problem is not documented anywhere yet.",
        cue: "Run the similarity check.",
        anchor: "knowledge-check-run",
        advance: { kind: "appears", anchor: "knowledge-draft-toggle" },
        perform: (_ctx, dom) => dom.click("knowledge-check-run"),
      },
      {
        id: "kb-draft-open",
        as: "dept-agent",
        route: ticketRoute,
        say:
          "So the outcome is a new draft. Linking an existing article or recording a " +
          "documented exception would satisfy the gate just as well -- what is not " +
          "allowed is ignoring the question.",
        cue: "Start a new draft.",
        anchor: "knowledge-draft-toggle",
        advance: { kind: "appears", anchor: "draft-body" },
        perform: (_ctx, dom) => dom.click("knowledge-draft-toggle"),
      },
      {
        id: "kb-summary",
        as: "dept-agent",
        route: ticketRoute,
        say: "The title is prefilled from the ticket subject -- run token and all.",
        cue: "Write the summary.",
        anchor: "draft-summary",
        advance: { kind: "filled", anchor: "draft-summary" },
        perform: (ctx, dom) => dom.type("draft-summary", ctx.articleSummary),
      },
      {
        id: "kb-body",
        as: "dept-agent",
        route: ticketRoute,
        say:
          "Markdown, and it becomes a real file on disk under knowledge-base/ -- the " +
          "database row and the file are written together. Articles are reviewable in " +
          "git, which is deliberate.",
        cue: "Write the article body.",
        anchor: "draft-body",
        advance: { kind: "filled", anchor: "draft-body" },
        perform: (ctx, dom) => dom.type("draft-body", ctx.articleBody),
      },
      {
        id: "kb-create",
        as: "dept-agent",
        route: ticketRoute,
        say:
          "Recording the outcome satisfies the last gate condition, so the ticket " +
          "resolves itself -- no second click on Submit resolution. It also records " +
          "which article it came out of.",
        cue: "Create the draft.",
        anchor: "draft-create",
        advance: { kind: "text", pattern: /^Resolved$/, within: "ticket-status" },
        perform: (_ctx, dom) => dom.click("draft-create"),
      },
    ],
  },
  {
    id: "publish",
    title: "Review",
    premise: "A draft is not knowledge until someone accountable publishes it.",
    steps: [
      {
        id: "publish-handoff",
        as: "knowledge-manager",
        route: "/knowledge/manage",
        say:
          "Kai Knowledge. Alex could draft, but not publish -- separation of duties, " +
          "and the reason those are two different roles rather than one.",
        advance: { kind: "read" },
      },
      {
        id: "publish-article",
        as: "knowledge-manager",
        route: "/knowledge/manage",
        say:
          "One honest footnote: this console publishes straight from DRAFT. " +
          "IN_REVIEW exists in the schema, but submitArticleForReview is not on this " +
          "path today, so the demo does not pass through it. Worth knowing before " +
          "someone finds it themselves.",
        cue: "Publish the draft.",
        anchor: "article-publish",
        within: { anchor: "article-row", containing: (ctx) => ctx.subject },
        advance: { kind: "text", pattern: /PUBLISHED/, within: "article-row" },
        perform: (ctx, dom) =>
          dom.click("article-publish", {
            anchor: "article-row",
            containing: ctx.subject,
          }),
      },
    ],
  },
  {
    id: "deflect",
    title: "Reuse",
    premise: "The next person with this problem never files a ticket.",
    steps: [
      {
        id: "deflect-handoff",
        as: "customer2",
        route: "/tickets/new",
        say:
          "Jordan, a different franchise partner, hits the same wall the following " +
          "week. Same form Casey used, and Jordan cannot see Casey's ticket -- " +
          "customers are scoped to their own.",
        advance: { kind: "read" },
      },
      {
        id: "deflect-subject",
        as: "customer2",
        route: "/tickets/new",
        say:
          "Note the wording is different from Casey's. The match has to survive " +
          "paraphrasing, which is why this is full-text search over title and " +
          "summary rather than a string compare.",
        cue: "Type Jordan's subject.",
        anchor: "ticket-subject",
        advance: { kind: "filled", anchor: "ticket-subject" },
        perform: (ctx, dom) => dom.type("ticket-subject", ctx.similarSubject),
      },
      {
        id: "deflect-description",
        as: "customer2",
        route: "/tickets/new",
        say: "Same symptoms, described by a different person.",
        cue: "Describe the issue.",
        anchor: "ticket-description",
        advance: { kind: "filled", anchor: "ticket-description" },
        perform: (ctx, dom) => dom.type("ticket-description", ctx.description),
      },
      {
        id: "deflect-suggested",
        as: "customer2",
        route: "/tickets/new",
        say:
          "There it is -- the article Alex wrote 90 seconds ago, surfaced before " +
          "Jordan finishes typing. The suggestion carries its own match reasons, so " +
          "it can say WHY it thinks this is relevant. Nothing here is generated; it " +
          "cites published articles or stays quiet.",
        anchor: "suggestions-card",
        advance: { kind: "appears", anchor: "suggestions-card" },
      },
      {
        id: "deflect-solved",
        as: "customer2",
        route: "/tickets/new",
        say:
          "Jordan reads it and it works. Marking it solved records the deflection " +
          "against the article, which is how usage and helpful counts on the manage " +
          "console get their numbers.",
        cue: "Mark it solved.",
        anchor: "deflect-solved",
        within: { anchor: "suggestion-row", containing: (ctx) => ctx.subject },
        advance: { kind: "appears", anchor: "deflected-confirmation" },
        perform: (ctx, dom) =>
          dom.click("deflect-solved", {
            anchor: "suggestion-row",
            containing: ctx.subject,
          }),
      },
      {
        id: "deflect-proof",
        as: "customer2",
        route: "/dashboard",
        say:
          "And Jordan's ticket list is empty. One ticket in, one article out, and the " +
          "second report of the same problem cost the desk nothing. That loop closing " +
          "is the whole argument for gating resolution on knowledge.",
        advance: { kind: "read" },
      },
    ],
  },
];

/** Flat step list, in order. Handy for the engine and for the anchor test. */
export const TOUR_STEPS = TOUR.flatMap((beat) =>
  beat.steps.map((step) => ({ beat, step })),
);
