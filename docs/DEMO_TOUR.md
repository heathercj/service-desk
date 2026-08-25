# The guided demo tour (Henry)

An in-app tour that carries a viewer through the golden path -- a welcome,
intake, triage, the work, the resolution gate, the article, the review, and
the deflection -- creating real records as it goes.

Built to **teach the workflow** to the people who will use the desk:
franchise partners, triage, department agents, whoever ends up looking after
the knowledge base. That shapes everything about the narration.

- It names the job being done, never the mechanism doing it. No route names,
  no schema names, no table names. A viewer should leave able to do their part
  of this, not able to describe how it is built. The technical account of the
  same path is `docs/TICKET_LIFECYCLE.md` and
  `docs/KNOWLEDGE_LIFECYCLE.md` -- send a developer there instead.
- It opens with four narration-only steps (the `welcome` beat) that introduce
  Henry, say what the Service Desk is for, and state what the viewer should
  leave knowing. A walkthrough that starts by filling in a form teaches the
  form, not the desk.
- It still may not overstate what the app does. Several lines are narrower
  than they could be for that reason -- `kb-check` says drafts are included in
  the agent's search because they are, and `deflect-proof` does not claim
  Jordan's ticket list is empty because it is not.

The pace is set for someone seeing this for the first time: reading dwell,
per-character typing, the pause before each click and the hold after each
form is filled are all deliberately slow, and the panel type is sized to be
read across a room rather than over a shoulder. See **Pace** below.

## The scenario

Deliberately the most ordinary problem the desk gets, because the point is
the loop and not the ticket:

1. Casey cannot sign into her email. She says her password is not working and
   that the same password is fine on her phone.
2. Technology Support works it with her. The detail that matters -- it works
   on another device -- points at the browser, not the account. The fix is to
   clear cache and cookies.
3. The fix becomes an article, titled for what the next person will search
   for rather than what Casey happened to type.
4. Jordan hits the same wall, in his own words, and is offered that article
   before he finishes filling in the form.

It routes itself, too, with no help from the tour: `email` and `password` are
Technology Support keywords in `src/lib/tickets/department-suggestion.ts`, so
the triage beat shows a real suggestion rather than a staged one.

All of it lives in `createTourContext()` in `src/lib/demo/tour-script.ts` --
one function, so the scenario can be swapped without touching the beats.

## Driving it

Three ways, and the first is the one to use:

- **Next.** A presenter clicks Next and talks over each beat. On a step with
  something to do, Next does it and then lets the app's own advance condition
  carry the step, so it cannot skip past work the app has not really done.
  This is the recommended way to give the tour: it moves when the room is
  ready, which no timer can guess.
- **Autopilot.** Runs itself on timers. Useful unattended -- a screen in a
  corner, or the e2e spec that proves all thirty-six steps still advance --
  but a full run at presentation pace is over seven minutes of watching
  software drive itself.
- **Clicking the real app.** The advance conditions watch the app, not the
  panel, so a presenter can ignore the buttons entirely and just use the
  product. `Fill it in for me` sits beside Next for the typing steps.

## Running it

```bash
# .env needs both -- the tour signs itself in as seeded dev identities
ENABLE_DEV_AUTH=true
ENABLE_DEMO_TOUR=true

pnpm demo:prep   # reset to the seeded desk -- run this before every demo
pnpm dev
```

`demo:prep` is not optional politeness. Department queues are newest-first,
so anything a previous walk or e2e run left behind sits at the TOP of the
queue Alex opens -- the first rows the room reads. It resets rather than
sweeps, because `demo:clean` can only find litter carrying the tour's run
token, and the other e2e specs create tickets with no token at all. It ends
by printing the top of that queue, which is worth reading before you
present: anything there you do not recognise is not seed data.

It is destructive and local-only. If you have exploration worth keeping, run
`pnpm demo:clean --yes` instead and accept that non-tour leftovers stay.

Nothing starts on its own. A launcher offers itself in the bottom-right
corner and the app is otherwise untouched, so free exploration stays the
default. Two ways in:

- **Start** -- Henry narrates, you click. Steps that need text offer
  "Fill it in for me", because nobody should type a run token by hand in
  front of an audience.
- **Autopilot** -- Henry drives. Toggle either way mid-tour with
  "Autopilot" / "Take the wheel".

Exit at any time with the `x`; it clears the tour and hands control back.
Append `?tour=fast` to strip the deliberate typing and reading pauses --
useful for rehearsal, wrong for a live audience.

Identity handoffs are real sign-ins through the dev-credentials provider, so
the nav visibly changes between beats and every route re-checks server-side.
The tour's place is kept in `sessionStorage`, which is what lets it survive
the full page load each handoff causes.

## Wandering off

A technical audience will click something else mid-tour. Henry brings you to
a step's route once; if you leave again he offers "Back to <beat>" rather
than dragging you back. The spotlight is `pointer-events: none` throughout,
so the dimming never traps the pointer.

## Cleaning up

Every run creates a ticket, an article row, and a real Markdown file under
`knowledge-base/`. Runs never collide -- each plants a one-off token -- but
the files accumulate in the working tree.

```bash
pnpm demo:clean          # report what it would remove
pnpm demo:clean --yes    # remove it
```

Cleaning up afterwards is still worth doing -- it is what keeps the Markdown
files out of a commit -- but it is no longer what a demo depends on. Prepping
at the start (`pnpm demo:prep`, above) is, because that does not rely on the
previous presenter having remembered.

It keys off the run token in the ticket subject and article title, and
deletes files by the `filePath` on the row rather than guessing from
filenames. Tickets go first: `TicketKnowledgeLink` does not cascade from the
article side, so an article still linked to a ticket cannot be deleted until
the ticket is. It also sweeps Markdown files whose article row is already
gone, which is what a `db:reset` between runs leaves behind.

## How it is put together

| File                                 | Role                                                                                       |
| ------------------------------------ | ------------------------------------------------------------------------------------------ |
| `src/lib/demo/tour-script.ts`        | **The manifest.** The demo, as data: beats, steps, narration, anchors, advance conditions. |
| `src/lib/demo/tour-types.ts`         | Step/advance/context types.                                                                |
| `src/lib/demo/dom-drive.ts`          | Anchor resolution, `observeUntil`, and the autopilot driver.                               |
| `src/components/demo/demo-guide.tsx` | The engine: identity, routing, advance detection, autopilot.                               |
| `src/components/demo/spotlight.tsx`  | Scrim and ring, drawn as one element's box-shadow.                                         |
| `src/components/demo/henry.tsx`      | Inline SVG lion, and the speech bubble his narration sits in.                              |
| `src/components/demo/tour-state.ts`  | `sessionStorage` persistence.                                                              |
| `scripts/demo-clean.ts`              | Litter sweep.                                                                              |
| `scripts/demo-prep.ts`               | Pre-demo reset to the seeded desk, and a look at what the room will see.                   |

Both modes consume the same manifest. There is deliberately no second copy
of the choreography.

### Advance conditions

A step finishes when the app confirms it did something -- never when a human
presses Next. `read` steps, which have no side effect, are the only
exception. There is deliberately no `click` advance: firing because the human
hit the button, rather than because the app did something, is the same silent
failure `emptied` exists to catch.

**The Next button does not weaken this.** On a step with a `perform()`, Next
runs the perform and then stops; the advance condition still has to observe
the app before the step moves. Next never calls `advance()` except on a
`read` step. That is deliberate and slightly awkward on purpose: a Next that
force-advanced would be the `click` advance under another name, so on a step
whose action has already run Next does nothing and the app's own condition is
what moves things on. `deflect-suggested` has no `perform()` and is not a
`read` step, so it shows no Next at all -- the suggestion appearing is the
condition, and there is nothing for a human to do but see it.

There is one more advance kind than there used to be. `filled` asks whether a
field is non-empty, which is the wrong question for a field the app
pre-fills: the draft title starts as the ticket subject, so `filled` is true
on arrival and the step satisfies itself before anyone types. `value` asks
whether the field's value matches a pattern, which is the question that step
actually has.

A step also does not advance while its own `perform()` is still running.
`filled` is satisfied by the first character, so without that guard clicking
"Fill it in for me" moved the panel to the next cue seconds before the typing
finished -- and a presenter following the cue promptly submitted a form the
server then rejected. The `emptied` condition exists because of a bug the golden-path
spec documents at `demo-golden-path.spec.ts:139-142`: asserting the reply
text is visible passes against the copy still sitting in the textarea, while
the POST was cancelled and nothing saved. The box clearing is the proof.

### Anchors and drift

Steps address the UI through `data-tour` attributes rather than text or ARIA
roles. Three layers keep them honest:

1. `src/lib/demo/tour-script.test.ts` -- the manifest is internally coherent:
   unique ids, real seeded identities, nothing needs the ticket number before
   it is captured, no performing step advances on a human's word.
2. `src/lib/demo/tour-anchors.test.ts` -- every anchor the manifest names is
   rendered somewhere, and no rendered anchor is orphaned. Both directions,
   so dead attributes get cleaned up too.
3. `e2e/demo-golden-path.spec.ts` -- anchor assertions threaded through the
   walk that already visits every one of these states, checking each anchor
   resolves to exactly one element on the beat that needs it.

Layer 2 catches a deleted attribute in milliseconds; layer 3 catches one that
exists but has become ambiguous or unreachable.

### Does the tour itself still work?

Two specs, and the difference between them matters.

`e2e/demo-tour-autopilot.spec.ts` hands the wheel to Henry and checks only
that he arrives. Every handoff, route push, `perform()` and advance condition
has to fire for the completion card to appear, because a stalled step never
advances.

`e2e/demo-tour-guided.spec.ts` walks **mode 1** -- the mode the demo is
actually given in -- by clicking the real controls through the overlay,
taking only the "Fill it in for me" affordance a presenter would take. This
is the one that can catch a control autopilot reaches and a cursor cannot: a
button under the scrim, or one that has scrolled out of reach. It asserts the
list of thirteen real clicks, so a refactor cannot quietly turn the walk back
into autopilot and keep passing.

### What the room sees behind Henry

The seed decides that, and two parts of it are there for the demo rather than
for the tests:

- **Ticket numbers continue.** The seed writes `SD-001000`..`SD-001010`
  directly and then advances the counter live tickets draw from, so the ticket
  Casey files during the tour is the next number in that sequence. Without it
  the first ticket anyone filed was `SD-000001` in a list of `SD-001000`s,
  which reads as an empty desk with fake history bolted on -- and it is the
  first thing an audience notices.
- **Timestamps are spread out.** Each seeded ticket carries an `ageHours`, and
  its status changes, messages and notes are derived from it, so the queues
  read like a week of work rather than eleven tickets filed in the same
  second. Numbers are handed out oldest-first, so a low number is an old
  ticket.

Both live in `prisma/seed.ts`. Seeded article dates are pinned rather than
taken from the clock, for a different reason: those files are in version
control, and "today" made every re-seed look like an edit.

### Pace

Four knobs, all deliberately slow:

| What                                   | Where                            | Value          |
| -------------------------------------- | -------------------------------- | -------------- |
| Reading dwell on a narration-only step | `dwellMs` in `demo-guide.tsx`    | 6s + 85ms/char |
| Per-character typing                   | `typeDelayMs` in `dom-drive.ts`  | 50ms           |
| Pause before autopilot clicks          | `clickDelayMs` in `dom-drive.ts` | 650ms          |
| Hold after a step's `perform()` ends   | `settleMs` in `demo-guide.tsx`   | 2s             |

`?tour=fast` overrides all four (dwell drops to 250ms, the rest to zero).
That is for rehearsal and for the two e2e specs -- a live audience needs the
pauses, and a viewer being taught this for the first time needs them most.

**The settle hold is not just another pause.** Without it the advance after a
form is filled is instantaneous, because `filled` is satisfied by the _first_
character typed: the moment the driver stops typing, the advance poll fires
and the panel jumps. So the audience watched a form being filled in and then
never saw it filled, which is the one frame showing what the step achieved.
It is implemented by holding the in-flight guard (see `runPerform`) rather
than as a second mechanism, so both autopilot and the mode-1 button get it and
neither can skip it -- the same guard described under Mode 1 below.

### Screenshots

Captured from the mode-1 walk itself, so they only ever show states the tour
genuinely reaches:

```bash
pnpm db:reset                                                                  # so the shots show a seeded desk
HENRY_SHOTS=1 pnpm exec playwright test demo-tour-guided                       # light
HENRY_SHOTS=1 HENRY_SHOTS_THEME=dark pnpm exec playwright test demo-tour-guided # dark
```

Add `E2E_BROWSER_CHANNEL=chrome` on a machine Playwright has no browser build
for -- Ubuntu 26.04 is one, where `playwright install` refuses outright and
the run fails on a missing `headless_shell`.

They land in `docs/screenshots/<theme>/`, named by step number -- so adding
or removing a step renames every shot after it, and the stale ones need
deleting by hand. Easiest is to empty both directories first and re-shoot
both themes; that is also how a rename that nobody noticed gets found.

Worth re-taking after a narration edit. The false claim in the closing beat
-- Henry insisting Jordan's ticket list was empty while five seeded tickets
sat behind the panel -- was found by looking at one, not by a test. So was the
panel appearing clipped at the bottom of the screen, which turned out to be
the shot catching it mid-transition rather than a layout bug; `shoot()` now
waits for it to settle.

## Known limits

- **The spotlight does not scroll its anchor into view.** Only `perform()`
  does, through `focusInto`. So in mode 1, a step whose control sits below the
  fold points at something the presenter cannot see -- `work-claim` is the one
  to look at, and `docs/screenshots/light/15-work-claim.png` is it happening.
  Autopilot never shows this because it always goes through `perform()`.
  Pressing "Do it for me" scrolls and recovers it; so does scrolling by hand.

- Dev-auth only, by construction. `src/lib/env.ts` refuses to boot with
  `ENABLE_DEMO_TOUR=true` in production, or without `ENABLE_DEV_AUTH`.
- `IN_REVIEW` is not on the path. The management console publishes straight
  from `DRAFT`. Henry used to admit this in the narration; he no longer does,
  because the gap between two internal article states is not something the
  tour's audience can act on. It is recorded here and in
  `docs/KNOWLEDGE_LIFECYCLE.md` instead. Nothing Henry says is false as a
  result -- "Kai reads it and publishes it" is exactly what happens -- but a
  developer reading the narration will not learn about it from there.
- Autopilot cannot recover from an app error mid-step. It surfaces the
  message in the panel and stops; take the wheel and continue by hand.
