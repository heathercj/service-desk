# Local setup checklist

Everything you need installed to run this project, and the exact version of
each. Work down the list once; after that, `pnpm preflight` will tell you if
your machine has drifted.

The versions here are not suggestions. They are what CI runs, and matching
them is what stops "works on my laptop" from becoming a debugging session.

## The short version

```bash
nvm install && nvm use                 # reads .nvmrc
corepack enable && corepack prepare pnpm@9.15.4 --activate
pnpm install
cp .env.example .env                   # then set AUTH_SECRET, see below
docker compose up -d
pnpm db:migrate && pnpm db:seed
pnpm preflight                         # should print "Ready."
pnpm dev
```

## Required

| Tool       | Version             | How to get it                                                | Why this version                                                                                                                                                   |
| ---------- | ------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Node.js    | **22.17.0**         | `nvm install && nvm use` (reads `.nvmrc`), or fnm/volta      | Pinned in `.nvmrc`; CI's `node-version: "22"` resolves to the same line. Node 24 mostly works but is not what CI runs.                                             |
| pnpm       | **9.15.4**          | `corepack enable && corepack prepare pnpm@9.15.4 --activate` | Pinned in `packageManager`. A different pnpm major can rewrite `pnpm-lock.yaml`, which shows up as noise in every PR.                                              |
| Docker     | any current release | Docker Desktop (macOS/Windows) or Docker Engine (Linux)      | Only used to run PostgreSQL. Compose v2 syntax (`docker compose`, not `docker-compose`).                                                                           |
| PostgreSQL | **16.6-alpine**     | Nothing to install -- `docker compose up -d` pulls it        | Pinned in `docker-compose.yml` and matched by CI's service container. Needs the extensions in `scripts/init-pg-extensions.sql`, which Compose loads on first boot. |

You do **not** need a local `psql`, or a local PostgreSQL of any kind. If you
already run one on 5432, either stop it or change the port in both
`docker-compose.yml` and `DATABASE_URL`.

## Required for end-to-end tests only

| Tool                | Version                               | How to get it                                       |
| ------------------- | ------------------------------------- | --------------------------------------------------- |
| Playwright browsers | **chromium-1193** (Playwright 1.55.1) | `pnpm exec playwright install --with-deps chromium` |

Playwright pins an exact chromium build per release. A newer chromium left in
`~/.cache/ms-playwright` by another project does **not** satisfy it, and the
failure gives no hint that a version mismatch is the cause -- `pnpm preflight`
names the build it wants.

On Linux, `--with-deps` also installs system libraries and will ask for sudo.

## Optional: security tooling

CI runs each of these in a pinned container, so you only need them locally to
reproduce a CI finding. None is required to develop.

| Tool        | CI pin                             | Local install                                      | Script                    |
| ----------- | ---------------------------------- | -------------------------------------------------- | ------------------------- |
| Semgrep     | `semgrep/semgrep:1.104.0`          | `pipx install semgrep`                             | `pnpm security:sast`      |
| Trivy       | `aquasecurity/trivy-action@0.36.0` | `brew install trivy`                               | `pnpm security:container` |
| OSV-Scanner | `google/osv-scanner-action@v2.0.2` | `brew install osv-scanner`                         | `pnpm security:sca`       |
| Gitleaks    | `gitleaks/gitleaks-action@v2.3.9`  | `brew install gitleaks`                            | `pnpm security:secrets`   |
| OWASP ZAP   | `zaproxy/action-baseline@v0.14.0`  | Docker image, see `scripts/security-dast-local.sh` | `pnpm security:dast`      |

## Environment file

`cp .env.example .env`, then set one value before anything will start:

```bash
AUTH_SECRET="$(openssl rand -base64 32)"
```

The rest of `.env.example` is already correct for local development: it points
at the Compose database, enables development sign-in (`ENABLE_DEV_AUTH=true`)
so you do not need an Entra app registration, and selects the local, key-free
AI provider (`AI_PROVIDER=local`).

Real Microsoft Entra ID sign-in is optional and separate --
[docs/ENTRA_SETUP.md](ENTRA_SETUP.md).

## Verifying

```bash
pnpm preflight    # machine setup
pnpm ci:local     # format:check, lint, typecheck, unit tests, build
```

`pnpm preflight` exits non-zero if a required check fails, and prints the fix
command under each one. Optional items only ever warn.

## When two machines disagree

Run `pnpm preflight` on both and compare, in this order:

1. **Node and pnpm versions.** By far the most common cause.
2. **Dependency freshness.** `pnpm-lock.yaml` newer than the last install
   means someone pulled a dependency change and did not run `pnpm install`.
3. **Database state.** `pnpm db:reset` reseeds from scratch; it is local-only
   and refuses to run against anything that does not look like localhost.
4. **Playwright browser build**, if the disagreement is about e2e.

If preflight passes on both machines and behaviour still differs, it is a real
bug and worth reporting as one.
