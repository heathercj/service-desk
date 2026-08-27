# Production launch runbook

This is the sequenced, detailed path from "runs on my laptop" to
"live at a real alairhomes.com subdomain, connected to this repo, with
real users signed in via Entra ID." It assumes AWS App Runner (confirmed
with you) for hosting, and Cloudflare for DNS on `alairhomes.com`.

Read **Part 0** first — it lists what's genuinely not ready yet, so
nothing here surprises you mid-launch.

---

## Part 0 — Know these before you start

### Blockers I already fixed for you this session

- **No way to seed baseline data in production.** `prisma/seed.ts` (roles,
  departments, franchises, demo data) refuses to run when
  `NODE_ENV=production` — by design, since it also seeds fake dev
  identities. `pnpm db:seed:baseline` is new: it seeds _only_ the real
  Role/Department/Franchise rows the app needs to function, and is safe to
  run in production. **Run this first**, before anything else touches a
  fresh production database.
- **No way to create the first Administrator.** `/admin/users` — the only
  place that grants roles — itself requires an existing Administrator to
  even load. `pnpm bootstrap:admin -- you@alairhomes.com` is new: it
  grants ADMINISTRATOR to a real user (who must have already signed in
  once) and refuses to run again once any Administrator exists, so it's a
  one-time bootstrap step, not a standing backdoor. See **Part 5**.

### Real gaps that are still open — decide how to handle each before real users depend on this

| Gap                                                                                                                                                                                | What happens if you launch anyway                                                                                                                                                                                                                                                | Fix                                                                                                                                                                                                                                                                 |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **No real outbound email.** `ConsoleEmailProvider` is the only `EmailProvider` implemented — it never sends anything, only writes a row to a dev-only mailbox.                     | Every notification this app already sends (staff replies to customers, mis-route transfer alerts, the Improvement Ideas thank-you, ticket-assigned/customer-reply/KB-published/dormant-ticket alerts) **will not reach anyone**. Nobody gets emailed, ever, until this is built. | Implement a real provider (Microsoft Graph `sendMail`, reusing the app-only Graph client already built for email intake — see `docs/ENTRA_SETUP.md` §9 for the permissions it needs). This is real, scoped, buildable work — ask if you want it done before launch. |
| **Object storage is a local disk path.** `OBJECT_STORAGE_ROOT` defaults to `./storage/uploads`, and nothing in the Dockerfile mounts a persistent volume for it.                   | App Runner instances are ephemeral — **every uploaded screenshot/attachment is lost on the next redeploy or restart.** Since every push to `main` triggers a redeploy (that's the whole point of "connected to your repo"), this could mean daily data loss.                     | Implement an S3-backed `ObjectStorageProvider`. Scoped, buildable — ask if you want it done before launch.                                                                                                                                                          |
| **No admin UI for department membership.** `/admin/users` can toggle a user's _roles_, but nothing puts a `DEPARTMENT_AGENT`/`DEPARTMENT_MANAGER` into an actual department queue. | A user granted the DEPARTMENT_AGENT role still can't see or work any queue until someone adds a `DepartmentMembership` row directly in the database.                                                                                                                             | Either build a small admin UI for this, or use the manual database step in **Part 5**.                                                                                                                                                                              |
| **Rate limiter is in-memory**, not shared (e.g. Redis).                                                                                                                            | Fine on a single App Runner instance (the default). If you ever scale to more than one instance, each gets its own independent budget — a bug that _silently allows more traffic through_, not less.                                                                             | Not a launch blocker at 1 instance. Revisit before adding instances.                                                                                                                                                                                                |

Full list, including lower-priority items: `docs/PRODUCTION_READINESS.md`.

**My recommendation**: at minimum, get real outbound email and real object
storage built before onboarding real users — both are small, contained,
and this app already has the pieces (the Graph client, the storage
abstraction) they'd plug into. Everything else in this runbook works
today regardless.

---

## Part 1 — AWS: container registry, build pipeline, App Runner

The app already has a production-ready multi-stage `Dockerfile`
(non-root user, standalone Next.js build, health check). The cleanest way
to keep App Runner using that exact Dockerfile _and_ keep deploys gated on
your existing CI checks (lint/typecheck/tests/security scans) is:
**GitHub Actions builds and pushes the image to Amazon ECR on every push
to `main`; App Runner deploys from ECR with auto-deploy on.** That's what
"connected to your repository" means end-to-end here — a push to `main`
is what starts the whole chain.

_(App Runner also offers a "connect directly to a GitHub repo" source
type, without a separate registry — it's simpler to set up but I'm not
fully confident it supports your existing Dockerfile as-is rather than
its own buildpack-style build; worth a five-minute look in the current AWS
console if you'd rather avoid the ECR step, but the path below is the one
I can vouch for start to finish.)_

### 1.1 Create the ECR repository

AWS Console → **ECR** → **Create repository**:

- Name: `service-desk`
- Keep "Scan on push" enabled (free, catches known-vulnerable base images).

### 1.2 Give GitHub Actions permission to push to ECR and deploy to App Runner

Don't use long-lived AWS access keys in GitHub. Use **OIDC federation** —
GitHub's own recommended pattern, no secret to leak or rotate:

1. AWS Console → **IAM** → **Identity providers** → **Add provider**:
   - Provider type: OpenID Connect
   - Provider URL: `https://token.actions.githubusercontent.com`
   - Audience: `sts.amazonaws.com`
2. **IAM** → **Roles** → **Create role** → **Web identity**, select the
   provider above, audience `sts.amazonaws.com`. Restrict the trust policy
   to your specific repo (replace `YOUR_GITHUB_ORG/service-desk`):
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Principal": {
           "Federated": "arn:aws:iam::<ACCOUNT_ID>:oidc-provider/token.actions.githubusercontent.com"
         },
         "Action": "sts:AssumeRoleWithWebIdentity",
         "Condition": {
           "StringEquals": {
             "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
           },
           "StringLike": {
             "token.actions.githubusercontent.com:sub": "repo:YOUR_GITHUB_ORG/service-desk:ref:refs/heads/main"
           }
         }
       }
     ]
   }
   ```
3. Attach a policy granting `ecr:GetAuthorizationToken`,
   `ecr:BatchCheckLayerAvailability`, `ecr:PutImage`,
   `ecr:InitiateLayerUpload`, `ecr:UploadLayerPart`,
   `ecr:CompleteLayerUpload` (scoped to the `service-desk` repo ARN), and
   `apprunner:StartDeployment` (scoped to the App Runner service ARN once
   it exists — come back and narrow this after step 1.4).
4. Note the role's ARN — you'll put it in a GitHub Actions secret.

### 1.3 Add the deploy workflow

This is a template — fill in the placeholders once the pieces above
exist, then add it as `.github/workflows/deploy.yml`. It's deliberately
**not** committed automatically by this runbook: it references an AWS
role ARN and App Runner service that don't exist yet, and a workflow that
fails on every push before that's true is worse than no workflow.

```yaml
name: Deploy to App Runner

on:
  push:
    branches: [main]

permissions:
  id-token: write # required for OIDC -- no stored AWS credentials
  contents: read

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Configure AWS credentials (OIDC)
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::<ACCOUNT_ID>:role/github-actions-service-desk
          aws-region: <YOUR_REGION> # e.g. us-east-1

      - name: Log in to ECR
        id: ecr-login
        uses: aws-actions/amazon-ecr-login@v2

      - name: Build and push image
        env:
          REGISTRY: ${{ steps.ecr-login.outputs.registry }}
          REPOSITORY: service-desk
          IMAGE_TAG: ${{ github.sha }}
        run: |
          docker build -t $REGISTRY/$REPOSITORY:$IMAGE_TAG -t $REGISTRY/$REPOSITORY:latest .
          docker push $REGISTRY/$REPOSITORY:$IMAGE_TAG
          docker push $REGISTRY/$REPOSITORY:latest

      - name: Trigger App Runner deployment
        run: |
          aws apprunner start-deployment \
            --service-arn <YOUR_APP_RUNNER_SERVICE_ARN>
```

Consider making this depend on `ci.yml` passing first (`needs:` a shared
workflow, or trigger on a successful `workflow_run` of `ci.yml`) once both
exist, so a broken build never reaches production.

### 1.4 Create the App Runner service

AWS Console → **App Runner** → **Create service**:

- Source: **Container registry** → **Amazon ECR** → browse to
  `service-desk:latest`.
- Deployment trigger: **Automatic** (redeploys whenever a new image is
  pushed — this is what makes step 1.3's push-triggered build take effect
  without a manual click).
- Port: `3000` (matches the Dockerfile's `EXPOSE 3000`).
- Instance configuration: start with **1 vCPU / 2 GB** — reasonable for a
  low-to-moderate-traffic internal tool; scale up later if needed.
- **Health check**: path `/api/health`, matches the Dockerfile's own
  `HEALTHCHECK`. (`/api/ready` also exists and additionally checks the
  database — usable in the same slot if you'd rather fail health checks on
  a DB outage too, at the cost of restarting the whole service instead of
  just reporting the DB as unavailable.)
- **Environment variables**: see **Part 4** below — set them all here now,
  after you have real values from Parts 2 and 3.

Once created, App Runner gives you a `https://xxxxx.awsapprunner.com`
URL. Confirm it loads (it'll redirect to `/login`) before moving on.

Go back to the IAM policy from step 1.2 and narrow the `apprunner:*`
permission to this service's actual ARN now that you have it.

---

## Part 2 — Database: a decision for your dev team

You said you'd rather bring this to your dev team than have me decide —
here's what to put in front of them:

**Option A — Amazon RDS for PostgreSQL.** Automated backups, point-in-time
recovery, patching handled by AWS. This is what closes the "Backups" item
already tracked in `docs/PRODUCTION_READINESS.md` ("configure real
Postgres backup/restore ... and test a restore"). Costs more than
self-hosting. Standard pairing with App Runner: create the RDS instance in
the same VPC, connect App Runner to that VPC via a **VPC connector** (App
Runner is not in a VPC by default), and set `DATABASE_URL` to the RDS
endpoint.

**Option B — self-hosted Postgres** (a container on ECS/EC2, or elsewhere
you already run infrastructure). Cheaper, but your team owns backup
scheduling, point-in-time recovery (or the lack of it), patching, and
making sure the instance's lifecycle is independent of the app's own
deploys.

Either way: `DATABASE_URL` needs to be a real, stable, network-reachable
Postgres connection string before Part 4. Once you have it, run migrations
against it once (from your own machine, pointed at the real
`DATABASE_URL`):

```bash
DATABASE_URL="<real production connection string>" pnpm exec prisma migrate deploy
DATABASE_URL="<real production connection string>" pnpm db:search:setup
```

---

## Part 3 — Cloudflare DNS, the subdomain, and the certificate

App Runner manages ACM certificate issuance and renewal for you once you
associate a custom domain — you don't request the ACM certificate
yourself in the ACM console; App Runner does it and hands you the DNS
records to prove you own the domain.

1. Pick the subdomain (e.g. `servicedesk.alairhomes.com`).
2. App Runner service → **Custom domains** → **Link domain** → enter the
   subdomain.
3. App Runner shows you a set of DNS records to create — typically:
   - One or more **CNAME** records for certificate validation (name looks
     like `_xxxxx.servicedesk`, target looks like
     `_yyyyy.acm-validations.aws`).
   - A **CNAME** record for the subdomain itself, pointing at App
     Runner's default domain (something like
     `xxxxx.us-east-1.awsapprunner.com`).
4. In Cloudflare: **alairhomes.com zone → DNS → Add record** for each one
   App Runner listed. Type `CNAME`, exact name/target App Runner gave you.
   **Set Proxy status to "DNS only" (grey cloud), not "Proxied" (orange
   cloud).** This is the single easiest step to get wrong: if Cloudflare's
   proxy is on, it intercepts and rewrites the CNAME chain, and both the
   certificate validation and App Runner's own domain-ownership check will
   never complete.
5. Wait for validation — App Runner's console shows **Pending** →
   **Active**. Usually minutes; can take longer depending on DNS
   propagation.
6. Once **Active**, `https://servicedesk.alairhomes.com` serves the app
   directly, with a valid AWS-issued certificate that renews itself
   automatically for as long as those CNAME records stay in place. Don't
   remove them later thinking they were only needed once — renewal reuses
   them.

---

## Part 4 — Environment variables

Set these in the App Runner service's **Configuration → Environment
variables**. For anything secret (`AUTH_SECRET`, `ENTRA_CLIENT_SECRET`,
`DATABASE_URL`), use App Runner's **"Reference a secret"** option against
AWS Secrets Manager rather than pasting the raw value into a plaintext env
var field — closes the "Secrets" item in `docs/PRODUCTION_READINESS.md`.

| Variable              | Value                                 | Notes                                                                                                                |
| --------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`            | `production`                          |                                                                                                                      |
| `APP_BASE_URL`        | `https://servicedesk.alairhomes.com`  | Your real subdomain from Part 3.                                                                                     |
| `DATABASE_URL`        | _(from Secrets Manager)_              | From Part 2.                                                                                                         |
| `AUTH_SECRET`         | _(from Secrets Manager)_              | Generate with `openssl rand -base64 32`. Rotating this invalidates every active session.                             |
| `AUTH_URL`            | `https://servicedesk.alairhomes.com`  | Same as `APP_BASE_URL`.                                                                                              |
| `ENTRA_TENANT_ID`     | _(from Part 6)_                       |                                                                                                                      |
| `ENTRA_CLIENT_ID`     | _(from Part 6)_                       |                                                                                                                      |
| `ENTRA_CLIENT_SECRET` | _(from Secrets Manager, from Part 6)_ |                                                                                                                      |
| `ENABLE_DEV_AUTH`     | `false`                               | **Must be false.** The app hard-refuses to start otherwise, but set it explicitly rather than relying on that guard. |
| `ENABLE_DEMO_TOUR`    | `false`                               | Same reasoning.                                                                                                      |
| `EMAIL_PROVIDER`      | `console`                             | Only value that currently exists — see Part 0's outbound-email gap.                                                  |
| `AI_PROVIDER`         | `local`                               | Only value that currently exists (deterministic local search, not a real embedding model).                           |
| `OBJECT_STORAGE_ROOT` | `./storage/uploads`                   | Only relevant until the S3 gap in Part 0 is closed — uploads won't survive a redeploy until then.                    |
| `RATE_LIMIT_*`        | leave at defaults                     | Fine for a single instance.                                                                                          |

Leave `ENABLE_EMAIL_INTAKE`/`SUPPORT_MAILBOX_ADDRESS`/
`GRAPH_WEBHOOK_CLIENT_STATE` unset for now — that's Part 7, optional and
separate from getting the core app live.

---

## Part 5 — First Administrator and onboarding every other user

1. **Seed the baseline** (once, against production `DATABASE_URL`):
   ```bash
   DATABASE_URL="<real production connection string>" pnpm db:seed:baseline
   ```
2. **Sign in for real, once**, as whoever should be the first
   Administrator, at `https://servicedesk.alairhomes.com`. This creates
   their `User` row automatically (Auth.js does this on first sign-in) —
   with no roles yet.
3. **Bootstrap them to Administrator**:
   ```bash
   DATABASE_URL="<real production connection string>" pnpm bootstrap:admin -- them@alairhomes.com
   ```
   This only works once — it refuses if any Administrator already exists.
4. **Every other user**: have them sign in once (creates their account),
   then the new Administrator signs in and visits `/admin/users` to grant
   roles (`CUSTOMER`, `TRIAGE_AGENT`, `DEPARTMENT_AGENT`,
   `DEPARTMENT_MANAGER`, `KNOWLEDGE_MANAGER`, `ADMINISTRATOR`) to each
   person. There's no bulk-import today — this is one user at a time.
5. **Department agents/managers additionally need a `DepartmentMembership`
   row** — no admin UI exists for this yet (Part 0). Until that's built,
   this is a direct database step per agent:

   ```sql
   -- find the user and the department
   SELECT id, email FROM "User" WHERE email = 'agent@alairhomes.com';
   SELECT id, key FROM "Department" WHERE key = 'TECHNOLOGY_SUPPORT';

   -- add them to it (isManager: true for a department manager)
   INSERT INTO "DepartmentMembership" (id, "userId", "departmentId", "isManager")
   VALUES (gen_random_uuid(), '<user id>', '<department id>', false);
   ```

   Ask if you'd like a small admin-UI addition for this instead of the
   manual step — it's a contained, buildable piece of work.

---

## Part 6 — Microsoft Entra ID: production SSO

`docs/ENTRA_SETUP.md` covers the general app-registration walkthrough;
this is what's specific to doing it for production rather than local dev.

1. Register a **separate** app registration from whatever's used for dev
   (`Service Desk (Production)` or similar) — don't reuse the dev one.
   Same rules as `docs/ENTRA_SETUP.md` §1: single-tenant only, never
   "any organizational directory."
2. Redirect URI:
   `https://servicedesk.alairhomes.com/api/auth/callback/microsoft-entra-id`.
3. New client secret (Certificates & secrets) — this becomes
   `ENTRA_CLIENT_SECRET` in Part 4, stored in Secrets Manager, never in
   plaintext.
4. No Graph API permissions are needed for sign-in itself
   (`docs/ENTRA_SETUP.md` §3) — skip straight to Part 4's env vars unless
   you're also doing Part 7.
5. Verify per `docs/ENTRA_SETUP.md` §7: visit `/login`, confirm only "Sign
   in with Microsoft" appears (no dev-identity panel — this is your proof
   `ENABLE_DEV_AUTH=false` actually took effect), sign in with a real
   account, confirm you land in the app.

**One more thing worth doing before onboarding a lot of users**: this
app's ticket-franchise resolution reads each employee's Entra
**`department`** attribute and matches it (case-insensitively) against a
franchise name or code (`Alair Homes Vancouver` / `VAN`, etc. — see
`src/lib/tickets/franchise-lookup.ts`). If that attribute isn't populated
for your users yet, everything falls back to "Head Office / Unassigned"
harmlessly (Triage can always correct it), but it's a much better first
impression if IT populates `department` for each user in Entra ahead of
launch, matching your franchise names or codes exactly.

---

## Part 7 — Optional: inbound email (support@alairhomes.com → ticket)

Separate, more involved, and genuinely optional for an initial launch —
`docs/ENTRA_SETUP.md` §8 has the complete walkthrough (Application
permissions, the Exchange Application Access Policy that's easy to get
wrong and over-scope, the three additional env vars, and running
`pnpm graph:subscribe` once deployed). Do the rest of this runbook first,
confirm the app works end to end, then come back to this when you're
ready — nothing here depends on it.

---

## Part 8 — Dormant-ticket alerts: schedule the sweep

An assigned ticket with no activity (no update, no internal note, no
message) for 3 days emails its assignee — mandatory, no opt-out — and shows
a bell icon on the queue and ticket-detail pages. Nothing in this repo runs
that check on its own: there's no in-process job runner, the same reason
Graph subscription renewal (Part 7) works without a cron job elsewhere. Set
one up yourself:

- **What to run**: `pnpm dormant:check` (`scripts/check-dormant-tickets.ts`)
  from the deployed app's environment (needs the same `DATABASE_URL`/
  `APP_BASE_URL` it runs with).
- **How often**: daily is enough — the threshold is 3 days, so an extra few
  hours of latency doesn't matter. Hourly is harmless too; the sweep is
  idempotent (a ticket already alerted since its last activity is skipped).
- **Where**: whatever your hosting platform offers for scheduled tasks —
  an App Runner/ECS scheduled task, a GitHub Actions workflow on a `cron:`
  trigger hitting the deployed environment, or plain OS cron/Task Scheduler
  if you're running this somewhere with a persistent host. Pick whichever
  your team already uses for other recurring jobs rather than introducing a
  new mechanism just for this one script.
- **Verify it's wired up**: run it once by hand right after deploying
  (`pnpm dormant:check`) and confirm it completes without error, then check
  back after the first scheduled run actually fires.

---

## Part 9 — Pre-launch smoke test

Work through this in order once Parts 1–6 are done:

- [ ] `https://servicedesk.alairhomes.com` loads with a valid certificate
      (padlock, issued by Amazon).
- [ ] `/api/health` returns `200 {"status":"ok"}`.
- [ ] `/api/ready` returns `200 {"status":"ready"}` (confirms the app can
      reach the database).
- [ ] `/login` shows only "Sign in with Microsoft" — no dev-identity
      panel.
- [ ] Sign in with a real Entra account succeeds and lands you in the app.
- [ ] Submit a test ticket. Confirm it's created, and confirm the
      franchise shown matches expectations (either a real franchise, or
      "Head Office / Unassigned" if that user's Entra `department` isn't
      set yet — both are correct, just confirm you know which you're
      seeing and why).
- [ ] As the bootstrapped Administrator, grant a second test user a role
      via `/admin/users` and confirm it takes effect for them.
- [ ] **Known, expected "failure"**: no real email will be delivered
      anywhere yet (Part 0) — don't be alarmed when a staff reply or
      transfer notification doesn't reach an inbox. That's the tracked
      gap, not a new bug.
- [ ] Visit `/settings/notifications` as a staff account and confirm the
      three toggles save and reload correctly.
- [ ] Confirm the Part 8 sweep is actually scheduled somewhere, not just
      run once by hand.

---

## Part 10 — Rollback

- **Code**: App Runner keeps prior deployments. Fastest rollback is
  reverting the bad commit and pushing to `main` — the same pipeline that
  deployed the bug redeploys the fix. App Runner's console also lets you
  manually redeploy a previous image tag if you need to move faster than a
  git revert.
- **Database**: this repo's Prisma migrations are forward-only — there
  are no authored "down" migrations. Reverting _code_ does not undo a
  _schema_ change that already ran. Be conservative about shipping schema
  changes close to launch, and test any migration against a copy of
  production data first if it touches existing columns/tables, not just a
  fresh empty database.

---

## Reference

- `docs/ENTRA_SETUP.md` — full Entra app-registration walkthrough,
  including §8 (email intake / Graph application permissions).
- `docs/PRODUCTION_READINESS.md` — the complete list of known gaps,
  including the ones summarized in Part 0.
- `docs/ARCHITECTURE.md`, `docs/TICKET_LIFECYCLE.md`,
  `docs/KNOWLEDGE_LIFECYCLE.md` — how the app itself works, if your dev
  team wants context beyond this runbook.
