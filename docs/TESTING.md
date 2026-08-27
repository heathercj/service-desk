# Testing

## Ground rule: tests before refactors

**No refactor starts until the code it touches has passing tests.** Write the
characterising test against current behaviour first, get it green, then change
the code and keep it green. A refactor with no test around it is a rewrite with
extra steps.

This applies to behaviour-preserving changes too — those are exactly the ones
where a test is the only thing that can tell you that you succeeded.

## The suites

| Suite       | Command                 | Config                         | Environment | What belongs here                                                                                                    |
| ----------- | ----------------------- | ------------------------------ | ----------- | -------------------------------------------------------------------------------------------------------------------- |
| Unit / BDD  | `pnpm test`             | `vitest.config.ts`             | jsdom       | Pure logic, route handlers, React components. No database, no network. Must stay fast.                               |
| Integration | `pnpm test:integration` | `vitest.integration.config.ts` | node        | Anything that needs real Postgres — services, Prisma queries, full-text search. Files named `*.integration.test.ts`. |
| End-to-end  | `pnpm test:e2e`         | `playwright.config.ts`         | browser     | Whole user journeys through the running app, plus accessibility checks.                                              |

`pnpm ci:local` runs format, lint, typecheck, the unit suite, and a build. The
integration and e2e suites are deliberately excluded — they need a live database
and a running server.

## Writing a scenario

Behaviour is expressed in Gherkin structure over plain Vitest, using the helpers
in [`src/test/bdd.ts`](../src/test/bdd.ts). We chose this over a `.feature` file
runner on purpose: no extra dependency, no second authoring surface, and steps
stay ordinary type-checked TypeScript.

```ts
import { feature, scenario } from "@/test/bdd";

feature("Ticket intake", () => {
  scenario("A customer submits a well-formed ticket", async (s) => {
    const customer = await s.given("a signed-in customer", () => { ... });
    const res      = await s.when("they submit the intake form", () => { ... });
    await s.then("the request succeeds", () => expect(res.status).toBe(200));
    await s.and("they are told the ticket number", () => { ... });
  });
});
```

Rules of thumb:

- **A scenario is one behaviour**, named as something a person does or observes —
  not after the function under test.
- **`given` establishes state, `when` performs exactly one action, `then`
  asserts.** If you need a second `when`, it is a second scenario.
- **A step body is optional.** A `given` with no body documents state that a
  fixture already established.
- **Failures name the step**, so keep step text specific: `"the request is
rejected as invalid"` beats `"it fails"`.
- **Use `scenario.each`** for a Scenario Outline — one row per example, with
  `$field` interpolation in the name.

## Fixtures

[`src/test/actors.ts`](../src/test/actors.ts) provides an `AuthContext` per role
(`actors.customer()`, `actors.triageAgent()`, `actors.departmentAgent()`, …).
Because `AuthContext` is the only source of roles and department membership, a
scenario's entire authorisation story is _which actor it passes_. Reach for
`makeActor()` directly only for unusual combinations — a two-department agent, a
cross-tenant identity.

## Testing a route handler

App Router handlers are just `(req, ctx) => Promise<Response>`, so they are
called directly — no HTTP server, no Next runtime. That keeps route tests in the
fast unit suite.

Routes are thin, so test only what a route owns: **who may call it, what it
rejects, how errors map to status codes, and the shape of the JSON it returns.**
Business rules belong to the service layer and are tested there.

```ts
vi.mock("@/lib/auth/session", () => import("@/test/session-mock"));
vi.mock("@/lib/tickets/ticket-service", () => ({ createTicket: vi.fn() }));

const { POST } = await import("./route");

setCurrentActor(actors.customer()); // or signOut() for the 401 scenario
const res = await readResponse(POST(jsonRequest("/api/tickets", payload)));
```

Handlers reach the session through `requireAuthContext()` rather than taking an
actor argument, so the seam has to be the module — hence the `session-mock`
import above. Dynamic segments come from `routeContext({ ticketId })`, which
supplies the promise-wrapped `params` Next 15 passes.

Every route should have at least: an **unauthenticated** scenario (401), a
**forbidden-role** scenario (403) where the endpoint is privileged, an
**invalid-payload** scenario (400), and the **happy path**.

## Testing a component

Components are rendered with Testing Library and driven with `userEvent` —
never by reaching into state or calling handlers directly. Query by role and
accessible name, so a scenario fails when the component stops being usable, not
when its markup is rearranged.

```ts
render(<SiteNav auth={{ displayName: "Dana", roles: ["TRIAGE_AGENT"] }} />);
await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
```

What belongs in a component scenario:

- **What a user can see and do** — the label on a control, which destinations a
  role is offered, that a disabled control refuses input.
- **What it hands to the outside world** — the request body it posts, the
  callback it invokes, the URL it signs out to. Stub the boundary (`fetch`,
  `next-auth/react`, `next-themes`) and assert the call.
- **Accessibility contracts** — a refusal is `role="alert"`, a nav is a labelled
  landmark, an invalid field carries `aria-invalid`.
- **Styling only where it carries meaning.** Asserting `bg-success` on a
  resolved badge is worth it; asserting padding is not. The token values behind
  those classes are guarded by
  [`src/app/theme-tokens.test.ts`](../src/app/theme-tokens.test.ts).

Two environment notes:

- jsdom 25 does not implement `<dialog>`'s modal methods; `confirm-dialog.test.tsx`
  stubs `showModal`/`close` to toggle the `open` attribute. Focus trapping and
  Escape are the browser's behaviour and belong to the e2e suite.
- Resolving a promise a component is awaiting has to be wrapped in `act()`, or
  React warns about an unwrapped update.

Thin primitives (`Input`, `Card`, …) are covered once, together, in
[`src/components/ui/primitives.test.tsx`](../src/components/ui/primitives.test.tsx)
— their contract is ref forwarding, className merging, and native semantics, not
each variant class.

## Setting up the integration database

The integration suite runs against its own database, kept separate from the one
the app and the e2e suite seed, so fixtures never mix into demo data. Nothing
creates it for you:

```bash
docker compose exec postgres psql -U service_desk -d postgres \
  -c "CREATE DATABASE service_desk_test OWNER service_desk"

export DATABASE_URL="postgresql://service_desk:service_desk_dev_password@localhost:5433/service_desk_test?schema=public"
pnpm exec prisma migrate deploy && pnpm db:search:setup
pnpm test:integration
```

`db:search:setup` is not optional — the similarity search needs `pg_trgm` and
the tsvector triggers, and `AUTH_SECRET`/`ENTRA_TENANT_ID` must be set for
`src/lib/env.ts` to validate.

### `DATABASE_URL` silently falls back to your dev database

If you skip the `export DATABASE_URL=...service_desk_test` step above and
just run `pnpm test:integration`, it does not fail loudly. `@prisma/client`
loads `.env` itself at runtime whenever `DATABASE_URL` isn't already in
`process.env` — a behaviour independent of anything in this app's own code
— so the suite quietly connects to `service_desk` (your dev database) using
whatever `.env` has, and every fixture user/ticket/email the run creates
lands there instead of in the disposable test database. Nothing in the
test output looks wrong; the tests pass and pollute real-looking dev data
at the same time.

Always export `DATABASE_URL` (pointed at `service_desk_test`) in the same
shell invocation you run `pnpm test:integration` from — an already-set env
var is what makes Prisma skip its own `.env` load. If you suspect this has
already happened, `entraObjectId` distinguishes real seeded dev identities
(`00000000-dev0-...`, from `src/lib/dev-auth/dev-identities.ts`) from
`createTestUser()` fixtures (`test-<uuid>`), so the pollution can be found
and deleted without touching real data.

## The demo walk

[`e2e/demo-golden-path.spec.ts`](../e2e/demo-golden-path.spec.ts) carries one
ticket through all five beats of the demo path in a single test — submitted by a
customer, routed by triage, worked and resolved by a department agent, published
as an article by a knowledge manager, and then deflecting a second customer who
has the same problem. Each actor runs in its own browser context, so the
hand-offs are real sessions.

Two rules make it worth having:

- **Nothing is conditional.** The other journey specs guard steps with
  `if (await x.isVisible())`, which means they pass when the step never
  happened. This one fails instead.
- **The data is its own.** A rare token is planted in the subject, so the
  article drafted from it is the one step 5's suggestion lookup finds — not
  something from the seed data.

Running it needs a live app and database:

```bash
docker compose up -d                  # Postgres on :5433 (service is "postgres")
pnpm db:migrate && pnpm db:seed       # schema, search setup, dev identities
pnpm test:e2e e2e/demo-golden-path.spec.ts
```

Three things that are easy to trip over:

- **The app must run in development mode.** `next start` forces
  `NODE_ENV=production`, and `src/lib/env.ts` refuses to boot with
  `ENABLE_DEV_AUTH=true` there — while every spec signs in through the dev
  identity picker. So `playwright.config.ts` starts `pnpm dev`. Point
  `E2E_WEB_SERVER` elsewhere for a production-mode server (see
  `.github/workflows/dast.yml`, which runs the standalone build with
  `NODE_ENV=test` for the same reason).
- **Browsers.** Playwright 1.55 has no download for Ubuntu 26.04, so
  `playwright install` fails there. `E2E_BROWSER_CHANNEL=chrome` drives the
  system Google Chrome instead.
- **`ENABLE_DEV_AUTH=true`** in `.env`, or `/login` offers no identities.

### Asserting a round-trip, not a filled-in box

`getByText(someText)` also matches text still sitting in the textarea the user
typed it into. A staff reply was failing with a foreign-key error for every
ticket, and two specs passed anyway because they asserted only the text. Assert
that the box **cleared** first — the component clears it only after the POST
resolves — and then that the text appears:

```ts
await expect(messageBox).toHaveValue("");
await expect(page.getByText(reply)).toBeVisible();
```

### The suite must survive its own second run

Nothing truncates the database between e2e runs, so any spec that writes a
**fixed** string poisons the next run. All three of these looked like different
bugs and were the same one:

- A reply of `"Thanks for the report..."` sent to the same seeded ticket every
  run. On the third run `getByText(reply)` matched three elements and failed
  Playwright's strict mode — a confusing error that says nothing about replies.
- A ticket created with the subject `"VPN client keeps disconnecting"` every
  run, failing the same way on the dashboard.
- A dev-mailbox assertion on fixed body text, which matched mail captured by
  _earlier_ runs — so it would have passed even if this run sent nothing.

Stamp anything the spec writes and then asserts on:

```ts
const reply = `Thanks for the report -- I'm looking into this now (${Date.now()}).`;
```

The demo walk already did this (a rare token in the subject); it is a rule for
every spec, and the last case shows why it is about correctness and not just
noise.

### Say which link you mean

Specs used `page.getByRole("link").first()` to open a ticket from a department
queue. When the queue grew view-filter links ("Unassigned", "Resolved", ...),
the first link became a filter, so the spec quietly navigated to another queue
view and failed several steps later on a missing textarea. Use
[`openFirstTicketFromQueue`](../e2e/queue-nav.ts), which matches
`a[href^="/tickets/"]` and asserts the resulting URL, so a miss fails where the
mistake is.

### Timeouts are sized for `next dev`, not a build

`playwright.config.ts` sets a 90s test timeout. Playwright's 30s default
assumes a prebuilt app; this suite runs against `next dev`, which compiles each
route on first hit, and a spec that signs in as three identities pays that cost
three times while five other workers compete for the same server. At 30s
`access-control` failed about one run in two with a bare timeout and no failing
assertion.

For the same reason `signInAsDevIdentity` waits with `waitUntil: "commit"`
rather than the default `load`: it only needs to know the navigation left
`/login`, and callers assert properly afterwards.

## Accessibility

[`e2e/accessibility.spec.ts`](../e2e/accessibility.spec.ts) runs axe-core over
the pages every role touches first and fails on `serious` or `critical`
violations.

Contrast is guarded a second time, and more cheaply, in
[`src/app/theme-tokens.test.ts`](../src/app/theme-tokens.test.ts): it measures
every `--x` / `--x-foreground` token pair with
[`src/test/contrast.ts`](../src/test/contrast.ts) (oklch to WCAG relative
luminance, agreeing with axe to 0.01) and fails any pair under 4.5:1. That check
covers **dark mode**, which no axe spec currently visits, and it names the token
instead of a CSS selector.

Two things it deliberately does not do:

- `--muted` / `--muted-foreground` is exempt. `--muted-foreground` is APEX's
  secondary _body_ text colour, sitting on `background`/`card` where it passes;
  it is only 3.81:1 against `--muted`. Its real contract is pinned by its own
  scenario.
- Because that exemption exists, a separate scenario greps the source for any
  element carrying **both** `bg-muted` and `text-muted-foreground`. One did
  (`safe-external-link.tsx`), and axe never caught it because no tested page
  renders that component.

## Coverage priority

Depth on the demo path outranks breadth everywhere else. In order:

1. Issue intake
2. Triage, assignment, and resolution
3. The resolution article created downstream of a resolved ticket
4. Review / confirm of that article
5. Reuse of the published article against a similar issue

See [TICKET_LIFECYCLE.md](TICKET_LIFECYCLE.md) and
[KNOWLEDGE_LIFECYCLE.md](KNOWLEDGE_LIFECYCLE.md) for the state rules those
scenarios assert against.

## The flake that was not about `next dev`

For a while the whole e2e suite would not pass at full width, while every
spec passed on its own. It looked like this:

- `dev-auth.ts` waits for the sign-in navigation to leave `/login` and it
  never does. The log shows two hops to `/login?callbackUrl=%2F`: the
  credentials post came back to the login page instead of through it.
- Occasionally an `accessibility.spec.ts` check fails in under three seconds
  against a page that passes on its own moments later.

**The cause was the sign-in rate limit, not compilation.** `src/middleware.ts`
limits `/api/auth/signin` and `/api/auth/callback` to twenty requests a
minute, keyed on `x-forwarded-for` -- and localhost never sends one, so the
key falls back to the literal string `unknown` and _every Playwright worker
shares one bucket_. The suite signs in around thirty times, because handing a
ticket between roles is what most of these specs are for. Everything past the
twentieth got a 429, `next-auth` returned to `/login`, and whichever spec lost
the race reported a mystery timeout.

You can watch it happen in one line:

```bash
for i in $(seq 1 25); do curl -s -o /dev/null -w "%{http_code} " localhost:3000/api/auth/signin; done
# 302 x20, then 429 429 429 429 429
```

That also explains the two things that had been tried and had not worked, both
of which look sensible until you know the cause:

- **Capping local workers to 4.** Fewer workers is the same thirty sign-ins,
  so the limit was still reached and the failure only moved to a different
  spec. It was reverted rather than kept as an unjustified knob -- correctly,
  as it turns out.
- **Raising the per-assertion timeout to 15s.** A 429 is instant and stays
  that way for the rest of the window, so no timeout was ever going to help.
  Worth keeping anyway: 5s against a compile-on-demand server is a latent
  flake wherever a bare `toBeVisible()` follows a route change.

And a third, attempted later and also not the fix: **running the suite against
a prebuilt server** (below). It removes compile-on-demand entirely and the
sign-in loop happened just the same, which is what finally ruled compilation
out.

### The fix

`RATE_LIMIT_AUTH_MAX` and `RATE_LIMIT_AUTH_WINDOW_MS` now configure that
limit, defaulting to the same 20/60s. `pnpm test:e2e` sets the max to 1000.

Twenty a minute is right for humans and wrong for a parallel suite arriving
from one IP; the shared-bucket fallback is the safe direction for a security
control and the hostile direction for tests. Nothing exercises the limit in
the e2e suite either way -- it is covered in
[`src/lib/http/rate-limit.test.ts`](../src/lib/http/rate-limit.test.ts),
including the twenty-first-request boundary and the shared-key behaviour, so
that this particular afternoon does not have to be repeated.

Do not raise the default to make something else pass. Raising the max raises
it for every caller at once, which is the whole point of the shared bucket.

## Running the suite against a prebuilt server

```bash
pnpm test:e2e:built
```

Not needed for the flake above, but worth having anyway: it builds once and
serves the build, so no route is compiled while a spec waits on it. The whole
suite runs in about **20 seconds** that way, against about **90 seconds**
on `next dev`, because almost all of that minute was compile-on-demand. Plain
`pnpm test:e2e` stays the right default for iterating on one spec, where the
build would cost more than it saves.

Getting there was not a matter of setting `E2E_WEB_SERVER`, and the reason is
worth writing down.

`next start` hard-sets `NODE_ENV=production` and `src/lib/env.ts` refuses to
start with `ENABLE_DEV_AUTH=true` there -- a deliberate hard guard, and every
spec signs in through the dev identity picker. The standalone build looks like
the way around it, since `node .next/standalone/server.js` is a plain Node
process that ought to inherit whatever `NODE_ENV` you give it. It does not:
**the launcher Next generates sets `process.env.NODE_ENV = 'production'` on
its fifth line**, before `require('next')`, so it overwrites what you passed
and the guard fires.

Which means `.github/workflows/dast.yml` had never worked, since the initial
commit. It sets `NODE_ENV: test` for exactly this reason and the generated
launcher discarded it; middleware matches `/api/health` too, so _every_
request 500ed and the "wait for the health endpoint" step could only exhaust
its thirty attempts and fail the job.

[`scripts/e2e-server.ts`](../scripts/e2e-server.ts) is that launcher without
the overwrite -- a transcription of the generated `server.js` minus one line.
The guard in `env.ts` is untouched and `NODE_ENV` really is `test`; the script
refuses to run under `production`, so it cannot become the route by which dev
auth reaches a real deployment. It also does two things the generated one does
not:

- **Copies `.next/static`.** `output: "standalone"` deliberately omits the
  client bundles, expecting the deployment to serve them. Without the copy
  every page renders once and then sits there unhydrated with every asset a
  404 -- which reads as a broken app, not a missing build step. (That is what
  ZAP would have been scanning, had DAST got that far.)
- **Does not `chdir` into the standalone directory.** `KNOWLEDGE_BASE_ROOT`
  and the default `OBJECT_STORAGE_ROOT` both resolve against `process.cwd()`,
  so a chdir would publish the suite's articles into
  `.next/standalone/knowledge-base`, where `pnpm demo:clean` and
  `pnpm kb:validate` would never look.

Three things to know when you use it:

- `reuseExistingServer` is on locally, so a `pnpm dev` already listening on
  3000 wins and the run quietly measures _that_ server instead. Stop it first.
- **`next dev` deletes the standalone build.** It rewrites `.next` on start,
  so any `pnpm test:e2e` after a build takes `.next/standalone` with it.
  `pnpm test:e2e:built` always rebuilds, so this only bites if you run
  `pnpm e2e:server` by hand; it fails loudly and tells you to build.
- The build is a real one, so a source change needs a rebuild.

Per-spec, `pnpm exec playwright test <file>` against `next dev` is reliable,
and CI is capped at two workers.
