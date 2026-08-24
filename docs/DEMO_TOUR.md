# The guided demo tour (Henry)

An in-app tour that carries a viewer through the golden path -- intake,
triage, the work, the resolution gate, the article, the review, and the
deflection -- creating real records as it goes.

Built for an internal-systems demo to a technical audience, which shapes the
narration: it names the enforcement point rather than the benefit, because
the room will read each line as a claim and then try to break it. Where the
app is less capable than the story implies, Henry says so (see
`publish-article`, which admits the console publishes straight from `DRAFT`).

## Running it

```bash
# .env needs both -- the tour signs itself in as seeded dev identities
ENABLE_DEV_AUTH=true
ENABLE_DEMO_TOUR=true

pnpm db:seed
pnpm dev
```

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

Both modes consume the same manifest. There is deliberately no second copy
of the choreography.

### Advance conditions

A step finishes when the app confirms it did something -- never when a human
presses Next. `read` steps, which have no side effect, are the only
exception. There is deliberately no `click` advance: firing because the human
hit the button, rather than because the app did something, is the same silent
failure `emptied` exists to catch.

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

### Screenshots

Captured from the mode-1 walk itself, so they only ever show states the tour
genuinely reaches:

```bash
HENRY_SHOTS=1 pnpm exec playwright test demo-tour-guided                       # light
HENRY_SHOTS=1 HENRY_SHOTS_THEME=dark pnpm exec playwright test demo-tour-guided # dark
```

They land in `docs/screenshots/<theme>/`. Worth re-taking after a narration
edit: the false claim in the closing beat -- Henry insisting Jordan's ticket
list was empty while five seeded tickets sat behind the panel -- was found by
looking at one, not by a test.

## Known limits

- Dev-auth only, by construction. `src/lib/env.ts` refuses to boot with
  `ENABLE_DEMO_TOUR=true` in production, or without `ENABLE_DEV_AUTH`.
- `IN_REVIEW` is not on the path. The management console publishes straight
  from `DRAFT`; Henry says so rather than letting someone find it.
- Autopilot cannot recover from an app error mid-step. It surfaces the
  message in the panel and stops; take the wheel and continue by hand.
