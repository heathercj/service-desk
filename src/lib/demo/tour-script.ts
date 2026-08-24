/**
 * THE MANIFEST. The demo, as data.
 *
 * This mirrors e2e/demo-golden-path.spec.ts beat for beat, deliberately: the
 * spec proves the path still works in CI, and this narrates the same path to
 * a room. Keeping them in step is what the anchor test is for.
 *
 * The two currently tell DIFFERENT stories -- the tour walks an email
 * sign-in problem, the spec still walks the older Buildertrend one. Same
 * beats, same order, different strings, and both pass. Worth aligning so the
 * demo and its CI proof read alike, but not required for either to work.
 *
 * Audience is the people who will USE the desk -- franchise partners, triage,
 * department agents, whoever ends up looking after the knowledge base. So the
 * narration is instructional and names the job being done, never the
 * mechanism doing it: no route names, no schema names, no table names. A
 * viewer should leave able to do their part of this, not able to describe how
 * it is built. The technical account of the same path lives in
 * docs/TICKET_LIFECYCLE.md and docs/KNOWLEDGE_LIFECYCLE.md, which is where a
 * developer should be sent instead.
 *
 * Nothing here may overstate what the app does. That rule survived the
 * rewrite from the old developer-facing narration and is the reason several
 * lines are narrower than they could be -- see `kb-check`, which says drafts
 * are included in the agent's search because they are, and `deflect-proof`,
 * which does not claim Jordan's ticket list is empty because it is not.
 */

import type { TourBeat, TourContext } from "./tour-types";

const TECH_SUPPORT_QUEUE = "/queue/TECHNOLOGY_SUPPORT";

/**
 * A fresh run token per tour, so consecutive demos never collide and the
 * final beat's lookup cannot match a previous run's article.
 *
 * Deliberately NOT in the ticket subject. The subject is the line everyone in
 * the room reads, and "I cannot sign into my email (henryabc123)" undercuts
 * the point of a realistic scenario. It lives in the description, where it
 * reads as a reference number, and in the article title -- which is where it
 * has to be: `publish-article` finds its row by title, and without a unique
 * one a demo database holding a dozen past drafts hands it the wrong row, and
 * the beat waits forever for someone else's article to say PUBLISHED.
 *
 * The `henry` prefix is what scripts/demo-clean.ts sweeps on -- do not change
 * it without changing the pattern there.
 */
export function createTourContext(now: number = Date.now()): TourContext {
  const run = `henry${now.toString(36)}`;
  return {
    run,
    subject: "I cannot sign into my email",
    similarSubject: "Email login not working since this morning",
    description:
      "Since this morning I cannot sign into my email. I type my password and " +
      "the page just returns me to the sign-in screen -- no error message, it " +
      "simply will not let me through. The same password works fine on my " +
      `phone. (ref ${run})`,
    similarDescription:
      "My email will not let me log in today. It keeps bouncing me back to the " +
      "login page after I enter my password. It works on my phone, just not on " +
      `my laptop. (ref ${run})`,
    reply:
      "Thanks -- the part that helps is that it works on your phone. That points " +
      "at the browser on your laptop rather than at your account. Could you " +
      "clear your cache and cookies and try signing in again?",
    resolutionSummary:
      "Stale cached sign-in data in the browser. Clearing cache and cookies " +
      "restored access.",
    resolutionSteps:
      "1. Confirmed the account itself was fine -- sign-in worked on another " +
      "device. 2. Had the user clear cached data and cookies in the browser on " +
      "the affected laptop. 3. Sign-in succeeded on the next attempt.",
    articleTitle: `Email sign-in keeps returning to the login page (ref ${run})`,
    articleSummary:
      "What to do when email sign-in bounces back to the login page on one " +
      "device but works on another: the browser is holding stale sign-in data.",
    articleBody:
      "## Symptoms\n\nEntering the correct password returns you to the sign-in " +
      "screen with no error message. The same account signs in normally on " +
      "another device, such as a phone.\n\n" +
      "## Cause\n\nThe browser is reusing cached sign-in data that is no longer " +
      "valid, so the attempt never reaches the account.\n\n" +
      "## Resolution\n\n1. Clear cached data and cookies in the affected " +
      "browser.\n2. Close the browser and open it again.\n3. Sign in as normal.",
  };
}

const ticketRoute = (ctx: TourContext) => `/tickets/${ctx.ticketNumber}`;

export const TOUR: TourBeat[] = [
  {
    id: "welcome",
    title: "Welcome",
    premise: "What the Service Desk is for, and what this walkthrough will show you.",
    steps: [
      {
        id: "welcome-hello",
        as: "customer",
        route: "/dashboard",
        say:
          "Hey, I'm Henry the Lion! If you are new here, I can show you around! I " +
          "will walk you through the Service Desk from the moment someone asks for " +
          "help to the moment the next person with the same problem does not have " +
          "to. Take your time -- and you can send me away at any point with the " +
          "little x up in the corner.",
        advance: { kind: "read" },
      },
      {
        id: "welcome-what",
        as: "customer",
        route: "/dashboard",
        say:
          "So, what is this? The Service Desk is the one place anyone at Alair goes " +
          "to ask another team for help -- a software problem, an accounting " +
          "question, a training request. Today those arrive as emails, calls and " +
          "texts, and the ones that get forgotten are forgotten quietly. Here, " +
          "every request becomes a ticket with a number, one team that owns it, and " +
          "a status the person who asked can check for themselves.",
        advance: { kind: "read" },
      },
      {
        id: "welcome-goal",
        as: "customer",
        route: "/dashboard",
        say:
          "Here is what I want you to leave knowing. Four things: how a request " +
          "gets in, how it reaches the right team, how that team works it, and -- " +
          "the one that matters most -- why finishing a ticket means writing down " +
          "what fixed it. That last part is how a service desk gets faster every " +
          "month instead of answering the same question forever.",
        advance: { kind: "read" },
      },
      {
        id: "welcome-cast",
        as: "customer",
        route: "/dashboard",
        say:
          "One practical note before we start. Five different jobs touch a single " +
          "ticket, so I will sign you in as five different people along the way and " +
          "tell you each time. Everything you are about to see is real -- a real " +
          "ticket, a real help article at the end of it, nothing staged.",
        advance: { kind: "read" },
      },
    ],
  },
  {
    id: "intake",
    title: "Asking for help",
    premise: "One form, in your own words. Nothing you have to look up.",
    steps: [
      {
        id: "intake-intro",
        as: "customer",
        route: "/tickets/new",
        say:
          "We start as Casey, a franchise partner. Casey has no special access -- " +
          "just an account -- and this form is the whole of what she has to do. " +
          "Notice what she is never asked: which department owns this, what " +
          "priority it is, or a category she would have to guess at. She describes " +
          "the problem; the desk works out the rest.",
        advance: { kind: "read" },
      },
      {
        id: "intake-subject",
        as: "customer",
        route: "/tickets/new",
        say:
          "First a one-line summary. Think of it as the subject of an email: it is " +
          "what everyone else sees in their list, so plain language beats jargon. " +
          '"Change order will not submit" is a good one.',
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
          "Now the detail -- what she was doing, and what happened instead. Keep " +
          "half an eye below the form while this types: the desk is already " +
          "searching the help articles, and if one of them answered this, Casey " +
          "would be reading it right now instead of filing a ticket. Nothing comes " +
          "up, because nobody has written this one yet. By the end of the " +
          "walkthrough, somebody will have.",
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
          "One tick box, and it is the only thing the form insists on beyond the " +
          "description itself: a reminder not to paste passwords or client " +
          "financials into a support ticket. Tickets get read by people who need to " +
          "fix things, not by people who need your bank details.",
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
          "And that is Casey done. Her ticket gets a number she can quote to " +
          "anyone, and the desk decides which department it belongs to and sends it " +
          "there. Casey never had to work out that an email problem belongs to " +
          "Technology Support -- which is the point, because she does not.",
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
    title: "Finding the right team",
    premise: "The desk proposes, a person confirms, and the decision has a name on it.",
    steps: [
      {
        id: "triage-handoff",
        as: "triage",
        route: "/triage",
        say:
          "Now I will sign you in as Taylor, who looks after triage. Watch the menu " +
          "along the top change as I do. Taylor gets a triage queue that Casey " +
          "never sees, and Casey's side of the desk is not somewhere Taylor " +
          "wanders. Everyone is shown what their job needs.",
        advance: { kind: "read" },
      },
      {
        id: "triage-open",
        as: "triage",
        route: "/triage",
        say:
          "Casey's ticket is already sitting here waiting. That is worth pausing " +
          "on: Taylor is not digging through a shared inbox deciding what is a " +
          "ticket and what is a reply -- the work arrives already sorted, with its " +
          "history attached.",
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
          "The desk has already proposed Technology Support. Taylor's job is to " +
          "agree, or to move it somewhere better -- and either way her name goes " +
          "against that decision. So routing takes seconds, but it is never " +
          "anonymous: months later you can still see who sent this where, and when.",
        cue: "Confirm the route.",
        anchor: "triage-confirm",
        advance: { kind: "text", pattern: /^Queued$/, within: "ticket-status" },
        perform: (_ctx, dom) => dom.click("triage-confirm"),
      },
    ],
  },
  {
    id: "work",
    title: "Doing the work",
    premise: "Someone owns it by name, and the person who asked can see where it stands.",
    steps: [
      {
        id: "work-handoff",
        as: "dept-agent",
        route: TECH_SUPPORT_QUEUE,
        say:
          "Meet Alex, on the Technology Support team. Alex sees his team's queue and " +
          "not Accounting's, and not Training's. This is how people stop being " +
          "copied in on things that were never theirs to deal with.",
        advance: { kind: "read" },
      },
      {
        id: "work-open",
        as: "dept-agent",
        route: TECH_SUPPORT_QUEUE,
        say:
          "There is Casey's ticket, and it is nobody's yet. An unowned request is " +
          "the one thing a service desk really cannot afford, so rather than being " +
          "quietly assumed by everyone, it sits here plainly unclaimed until " +
          "somebody takes it.",
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
          "Alex claims it, and now his name is on it. If two people reach for the " +
          "same ticket in the same minute, only one of them gets it -- so you never " +
          "get two agents quietly doing the same work, or Casey receiving two " +
          "different half-answers.",
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
          "Moving it to In Progress is a small thing that saves a lot of phone " +
          "calls: it is what Casey sees when she checks her ticket. She does not " +
          "have to ring anyone to find out whether it is being looked at.",
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
          "This box is the conversation with Casey -- she gets what Alex writes " +
          "here. There is a separate notes box further down for what the team says " +
          "to each other, so Alex can think out loud, or flag something for a " +
          "colleague, without that landing in front of the customer.",
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
          "Sent, and it stays on the ticket. That matters more than it sounds: if " +
          "Alex is off tomorrow and someone else picks this up, they read what has " +
          "already been said instead of asking Casey to explain it all again.",
        cue: "Send it.",
        anchor: "message-send",
        advance: { kind: "emptied", anchor: "message-body" },
        perform: (_ctx, dom) => dom.click("message-send"),
      },
    ],
  },
  {
    id: "gate",
    title: "Closing it out",
    premise: "A fix nobody else can find is not finished.",
    steps: [
      {
        id: "gate-summary",
        as: "dept-agent",
        route: ticketRoute,
        say:
          "Alex has fixed it -- it was an expired login, nothing exotic. Now watch " +
          "carefully, because what happens when he tries to close the ticket is the " +
          "part of the desk that is genuinely different from the one you are used to.",
        cue: "Fill in the resolution summary.",
        anchor: "resolution-summary",
        advance: { kind: "filled", anchor: "resolution-summary" },
        perform: (ctx, dom) => dom.type("resolution-summary", ctx.resolutionSummary),
      },
      {
        id: "gate-steps",
        as: "dept-agent",
        route: ticketRoute,
        say:
          "And what he actually did, step by step. This is a minute of typing, and " +
          "it is the only typing anyone does twice in this whole walkthrough -- keep " +
          "an eye on where it ends up.",
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
          "Refused. The ticket will not close. It parks in Resolution Review and " +
          "tells Alex exactly what is missing: he has not yet checked whether this " +
          "problem is already written up anywhere.",
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
          "Why be this strict? Because everyone means to write it up later, and " +
          "nobody does -- and then the desk spends the next two years answering the " +
          "same question by hand. So the rule here is simply that a fix nobody else " +
          "can find is not finished. Alex has three honest ways through: point at an " +
          "article that already covers it, write a new one, or record why this " +
          "particular ticket does not need documenting. What he cannot do is skip " +
          "the question.",
        advance: { kind: "read" },
      },
    ],
  },
  {
    id: "knowledge",
    title: "Writing it down",
    premise: "The fix becomes something the whole company can find.",
    steps: [
      {
        id: "kb-check",
        as: "dept-agent",
        route: ticketRoute,
        say:
          "So Alex searches what already exists -- including other people's " +
          "unfinished drafts, so two agents cannot unknowingly write the same " +
          "article twice. Nothing comes back, which is the honest answer: this " +
          "problem really is new to us.",
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
          "Nothing to point at, so he writes it. This is the moment a one-off fix " +
          "in one agent's head becomes something the company owns -- and it happens " +
          "here, while it is fresh, rather than in a documentation afternoon that " +
          "never gets scheduled.",
        cue: "Start a new draft.",
        anchor: "knowledge-draft-toggle",
        advance: { kind: "appears", anchor: "draft-body" },
        perform: (_ctx, dom) => dom.click("knowledge-draft-toggle"),
      },
      {
        id: "kb-title",
        as: "dept-agent",
        route: ticketRoute,
        say:
          "The title starts as Casey's own sentence, and it is worth changing. She " +
          "wrote what happened to her; the next person will search for what is " +
          "happening to them. Naming the symptom -- sign-in returning to the login " +
          "page -- is what makes this findable by somebody who has never seen this " +
          "ticket.",
        cue: "Give it a title someone would search for.",
        anchor: "draft-title",
        advance: {
          kind: "value",
          anchor: "draft-title",
          pattern: /^Email sign-in keeps returning/,
        },
        perform: (ctx, dom) => dom.type("draft-title", ctx.articleTitle),
      },
      {
        id: "kb-summary",
        as: "dept-agent",
        route: ticketRoute,
        say:
          "The summary is the bit somebody skims in a list of results, so it is " +
          "worth writing for a person who does not already know what went wrong.",
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
          "Then the article: what it looks like when it goes wrong, and what to do " +
          "about it. Alex is writing it from what he already put in the ticket, so " +
          "this is not a second job -- it is the same work, kept somewhere other " +
          "people can reach it.",
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
          "And the moment the article exists, the ticket resolves itself -- Alex " +
          "does not go back and press close a second time. Casey's problem is " +
          "finished, and the ticket keeps a note of which article came out of it, so " +
          "you can always ask where a piece of guidance actually came from.",
        cue: "Create the draft.",
        anchor: "draft-create",
        advance: { kind: "text", pattern: /^Resolved$/, within: "ticket-status" },
        perform: (_ctx, dom) => dom.click("draft-create"),
      },
    ],
  },
  {
    id: "publish",
    title: "Checking it",
    premise: "Someone accountable reads it before anyone relies on it.",
    steps: [
      {
        id: "publish-handoff",
        as: "knowledge-manager",
        route: "/knowledge/manage",
        say:
          "Alex could write the draft, but he cannot publish it. That is Kai's job " +
          "-- Kai looks after the knowledge base. It is a deliberate split: the " +
          "person who just fixed something is rarely the best judge of whether " +
          "their write-up makes sense to anybody else.",
        advance: { kind: "read" },
      },
      {
        id: "publish-article",
        as: "knowledge-manager",
        route: "/knowledge/manage",
        say:
          "Kai reads it and publishes it. Until this click, nobody outside the " +
          "ticket is offered that article at all -- which is what keeps the help " +
          "pages from filling up with half-finished notes that send people the " +
          "wrong way.",
        cue: "Publish the draft.",
        anchor: "article-publish",
        within: { anchor: "article-row", containing: (ctx) => ctx.articleTitle },
        advance: { kind: "text", pattern: /PUBLISHED/, within: "article-row" },
        perform: (ctx, dom) =>
          dom.click("article-publish", {
            anchor: "article-row",
            containing: ctx.articleTitle,
          }),
      },
    ],
  },
  {
    id: "deflect",
    title: "The payoff",
    premise: "The next person with the same problem never has to file a ticket.",
    steps: [
      {
        id: "deflect-handoff",
        as: "customer2",
        route: "/tickets/new",
        say:
          "Last stop, and this is the one the whole thing is for. A week later " +
          "Jordan -- a different franchise partner, a different city -- hits exactly " +
          "the same wall. He has never spoken to Casey and cannot see her ticket.",
        advance: { kind: "read" },
      },
      {
        id: "deflect-subject",
        as: "customer2",
        route: "/tickets/new",
        say:
          "Notice he describes it differently than Casey did -- his words, his " +
          "order. Nobody ever types the same sentence twice, so the desk has to " +
          "recognise the problem rather than match a phrase.",
        cue: "Type Jordan's subject.",
        anchor: "ticket-subject",
        advance: { kind: "filled", anchor: "ticket-subject" },
        perform: (ctx, dom) => dom.type("ticket-subject", ctx.similarSubject),
      },
      {
        id: "deflect-description",
        as: "customer2",
        route: "/tickets/new",
        say: "Same problem, in his own words. Now watch just below the form.",
        cue: "Describe the issue.",
        anchor: "ticket-description",
        advance: { kind: "filled", anchor: "ticket-description" },
        perform: (ctx, dom) => dom.type("ticket-description", ctx.similarDescription),
      },
      {
        id: "deflect-suggested",
        as: "customer2",
        route: "/tickets/new",
        say:
          "There it is. The article Alex wrote a minute ago, offered to Jordan " +
          "before he has even finished the form -- and he can see it because Kai " +
          "published it. It tells him why it thinks this is the one, too, so he can " +
          "judge it at a glance instead of opening five links to find out.",
        anchor: "suggestions-card",
        advance: { kind: "appears", anchor: "suggestions-card" },
      },
      {
        id: "deflect-solved",
        as: "customer2",
        route: "/tickets/new",
        say:
          "He reads it, tries it, and it works. Telling the desk so is how it " +
          "learns which articles are actually earning their keep -- Kai can see " +
          "which ones people use and which ones quietly help nobody and should be " +
          "rewritten.",
        cue: "Mark it solved.",
        anchor: "deflect-solved",
        // The suggestion row names the ARTICLE, not Casey's ticket. Those used
        // to be the same string, because the draft inherited the ticket
        // subject -- now the article has its own title, so scoping by subject
        // matches nothing and the step waits out the driver's timeout.
        within: { anchor: "suggestion-row", containing: (ctx) => ctx.articleTitle },
        advance: { kind: "appears", anchor: "deflected-confirmation" },
        perform: (ctx, dom) =>
          dom.click("deflect-solved", {
            anchor: "suggestion-row",
            containing: ctx.articleTitle,
          }),
      },
      {
        id: "deflect-proof",
        as: "customer2",
        route: "/dashboard",
        // Jordan is seeded with five unrelated tickets, so "his list is empty"
        // -- what this used to say -- is false on screen, in the closing beat,
        // to an audience that checks. The claim that is both true and worth
        // making is narrower: no ticket exists for THIS problem.
        say:
          "And here is the proof. Jordan's older tickets are still here, but there " +
          "is no new one for this problem -- he never had to file it. Nobody on " +
          "Technology Support was interrupted, and Jordan was sorted in about a " +
          "minute. One ticket in, one article out, and the second person with the " +
          "same problem cost the desk nothing at all. Do that a hundred times and " +
          "the team spends its days on new problems instead of the same twelve.",
        advance: { kind: "read" },
      },
    ],
  },
];

/** Flat step list, in order. Handy for the engine and for the anchor test. */
export const TOUR_STEPS = TOUR.flatMap((beat) =>
  beat.steps.map((step) => ({ beat, step })),
);
