# Local setup checklist

Everything you need installed to run this project, and the exact version of
each. Work down the list once; after that, `pnpm preflight` will tell you if
your machine has drifted.

The versions here are not suggestions. They are what CI runs, and matching
them is what stops "works on my laptop" from becoming a debugging session.

## The short version

macOS / Linux:

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

Windows 11 (PowerShell -- see [Windows 11](#windows-11) for the detail):

```powershell
fnm install 22.17.0; fnm use 22.17.0   # or nvm-windows: nvm install 22.17.0; nvm use 22.17.0
corepack enable; corepack prepare pnpm@9.15.4 --activate
pnpm install
Copy-Item .env.example .env            # then set AUTH_SECRET, see below
docker compose up -d
pnpm db:migrate; pnpm db:seed
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

| Tool        | CI pin                              | macOS / Linux              | Windows 11                                                                     | Script                    |
| ----------- | ----------------------------------- | -------------------------- | ------------------------------------------------------------------------------ | ------------------------- |
| Semgrep     | `semgrep/semgrep:1.104.0`           | `pipx install semgrep`     | `pipx install semgrep`                                                         | `pnpm security:sast`      |
| Trivy       | `aquasecurity/trivy-action@v0.36.0` | `brew install trivy`       | `winget install AquaSecurity.Trivy`                                            | `pnpm security:container` |
| OSV-Scanner | `google/osv-scanner-action@v2.0.2`  | `brew install osv-scanner` | [releases](https://github.com/google/osv-scanner/releases) (`_windows_amd64`)  | `pnpm security:sca`       |
| Gitleaks    | `gitleaks/gitleaks-action@v2.3.9`   | `brew install gitleaks`    | [releases](https://github.com/gitleaks/gitleaks/releases) (`_windows_x64.zip`) | `pnpm security:secrets`   |
| OWASP ZAP   | `zaproxy/action-baseline@v0.14.0`   | `pnpm security:dast`       | `pnpm security:dast` **from Git Bash** -- it is a shell script                 | `pnpm security:dast`      |

`pnpm preflight` prints the right one of these for the machine it is running
on, so you do not have to read the correct column yourself.

## Environment file

Copy `.env.example` to `.env` (`cp` on macOS/Linux, `Copy-Item` in
PowerShell), then set one value before anything will start:

```
AUTH_SECRET="<32 random bytes, base64>"
```

Node is already a prerequisite, so this generates one on every platform and
in every shell -- no openssl needed, which matters on Windows where there
usually is not one:

```
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

The rest of `.env.example` is already correct for local development: it points
at the Compose database, enables development sign-in (`ENABLE_DEV_AUTH=true`)
so you do not need an Entra app registration, and selects the local, key-free
AI provider (`AI_PROVIDER=local`).

Real Microsoft Entra ID sign-in is optional and separate --
[docs/ENTRA_SETUP.md](ENTRA_SETUP.md).

## Windows 11

Everything runs natively in PowerShell -- WSL2 is not required. Four things
differ from a Unix machine, and all four are already handled in the repo:

- **Line endings.** `.gitattributes` sets `* text=auto eol=lf`, so a Windows
  clone keeps LF in the working tree. Without it Git's default
  `core.autocrlf=true` would give every file CRLF and `pnpm format:check`
  would fail on all of them at once, with nothing in the output hinting that
  the checkout is the cause. If you cloned before that file existed, run
  `git rm --cached -r . && git reset --hard` once to re-checkout.

- **Environment variables in scripts.** `VAR=value command` is Unix shell
  syntax and does nothing in PowerShell or cmd. The three scripts that need
  it (`test:e2e`, `build:e2e`, `test:e2e:built`) go through `cross-env`, so
  `pnpm test:e2e` works the same in every shell.

- **Docker.** Docker Desktop with the WSL2 backend. It only ever runs
  PostgreSQL; `docker compose up -d` is identical. Make sure Desktop is
  actually started -- `pnpm preflight` distinguishes "not installed" from
  "installed but the daemon is not running", because on Windows the second
  is much the more common of the two.

- **The one script that still needs bash.** `pnpm security:dast` is a shell
  script driving the ZAP container, so run it from **Git Bash**. It already
  handles the two Windows-specific traps: Docker Desktop's container cannot
  reach the host through `--network host`, so the script targets
  `host.docker.internal` off Linux, and it sets `MSYS_NO_PATHCONV=1` so Git
  Bash stops rewriting the container-side half of the `-v` mounts. Every
  other `pnpm security:*` script is a plain executable and runs in
  PowerShell.

### Node version managers

`nvm` on Windows is [nvm-windows](https://github.com/coreybutler/nvm-windows),
a different program that shares only the name: it does not read `.nvmrc`, and
`nvm use` needs the version spelled out. Either pass it explicitly:

```powershell
nvm install 22.17.0
nvm use 22.17.0
```

or use [fnm](https://github.com/Schniz/fnm), which behaves the same on every
platform and does read `.nvmrc`:

```powershell
winget install Schniz.fnm
fnm use --install-if-missing
```

### A note on where you clone

Clone to a path with no spaces and no OneDrive redirection --
`C:\src\service-desk` rather than `C:\Users\you\OneDrive\Documents\...`.
OneDrive's on-demand sync and `node_modules` interact badly, and pnpm's
hardlinked store is exactly the kind of thing it handles worst.

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
