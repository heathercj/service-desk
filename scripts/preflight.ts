/**
 * `pnpm preflight` -- verify this machine can actually run the project.
 *
 * The point is that two contributors on two laptops get the same answer,
 * and that a mismatch says so here rather than surfacing later as a
 * mysterious failure three commands into the quick start. Every check
 * prints the command that fixes it.
 *
 * Exit code is 1 if any REQUIRED check fails. Optional checks (the local
 * security tooling) only ever warn -- CI runs those in pinned containers,
 * so not having them locally is a normal state to be in.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import net from "node:net";

// pnpm runs scripts with the package root as cwd, the same assumption
// scripts/e2e-server.ts makes.
const root = process.cwd();

type Status = "pass" | "warn" | "fail";
interface Result {
  name: string;
  status: Status;
  detail: string;
  fix?: string;
}
const results: Result[] = [];

function record(name: string, status: Status, detail: string, fix?: string) {
  results.push({ name, status, detail, fix });
}

const windows = process.platform === "win32";

/**
 * Run a command for its stdout; undefined if it is not installed or errors.
 *
 * `shell` is on for Windows because pnpm and playwright are installed there
 * as `.cmd` shims, and since Node 18.20 execFileSync refuses to spawn those
 * directly (EINVAL). Without it every pnpm-based check below reported a
 * confident FAIL on a machine that was set up correctly. Every argument
 * passed here is a literal flag, so there is nothing for the shell to
 * re-interpret.
 */
function run(cmd: string, args: string[]): string | undefined {
  try {
    return execFileSync(cmd, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      shell: windows,
    }).trim();
  } catch {
    return undefined;
  }
}

function readJson(file: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(root, file), "utf8")) as Record<
    string,
    unknown
  >;
}

/**
 * nvm-windows is a different program from nvm: it does not read .nvmrc, and
 * `nvm use` there needs the version spelled out. fnm behaves the same on
 * every platform, so it is the suggestion that always works.
 */
function nodeFix(version: string): string {
  return windows
    ? `nvm install ${version} && nvm use ${version}   # or: fnm use --install-if-missing`
    : `nvm install ${version} && nvm use   # or: fnm use --install-if-missing`;
}

// --- Node ------------------------------------------------------------------
// .nvmrc is the single source of truth; CI pins the same major.
const wantedNode = readFileSync(path.join(root, ".nvmrc"), "utf8").trim();
const actualNode = process.versions.node;
const [wantMajor] = wantedNode.split(".");
const [gotMajor] = actualNode.split(".");
if (actualNode === wantedNode) {
  record("Node.js", "pass", `v${actualNode}`);
} else if (gotMajor === wantMajor) {
  record(
    "Node.js",
    "warn",
    `v${actualNode}, .nvmrc asks for v${wantedNode} (same major, so this is fine in practice)`,
    nodeFix(wantedNode),
  );
} else {
  record(
    "Node.js",
    "fail",
    `v${actualNode}, but this project is built and tested on v${wantedNode}`,
    nodeFix(wantedNode),
  );
}

// --- pnpm ------------------------------------------------------------------
const pkg = readJson("package.json");
const wantedPnpm = String(pkg.packageManager ?? "").replace("pnpm@", "");
const actualPnpm = run("pnpm", ["--version"]);
if (!actualPnpm) {
  record(
    "pnpm",
    "fail",
    "not installed",
    `corepack enable && corepack prepare pnpm@${wantedPnpm} --activate`,
  );
} else if (actualPnpm === wantedPnpm) {
  record("pnpm", "pass", `v${actualPnpm}`);
} else {
  record(
    "pnpm",
    "fail",
    `v${actualPnpm}, but packageManager pins v${wantedPnpm} -- a different pnpm can rewrite pnpm-lock.yaml`,
    `corepack enable && corepack prepare pnpm@${wantedPnpm} --activate`,
  );
}

// --- Dependencies installed ------------------------------------------------
// Compared by mtime rather than by `pnpm install --frozen-lockfile`: there is
// no non-mutating way to ask pnpm "is node_modules in step?" (--dry-run is
// not a pnpm 9 flag), and actually installing is not a preflight's job.
// .modules.yaml is rewritten on every install, so a lockfile newer than it
// means someone pulled a dependency change and has not installed it -- which
// is the usual reason two laptops behave differently.
const modulesState = path.join(root, "node_modules/.modules.yaml");
if (!existsSync(path.join(root, "node_modules")) || !existsSync(modulesState)) {
  record("Dependencies", "fail", "node_modules is missing", "pnpm install");
} else {
  const lockAt = statSync(path.join(root, "pnpm-lock.yaml")).mtimeMs;
  const installedAt = statSync(modulesState).mtimeMs;
  if (lockAt > installedAt) {
    record(
      "Dependencies",
      "fail",
      "pnpm-lock.yaml is newer than the last install",
      "pnpm install",
    );
  } else {
    record("Dependencies", "pass", "installed since the last lockfile change");
  }
}

// --- Prisma client ---------------------------------------------------------
// pnpm generates into the virtual store, not node_modules/.prisma, so the
// path varies. Ask Prisma itself instead: an ungenerated client throws on
// require with a message telling you to run `prisma generate`.
try {
  execFileSync(
    process.execPath,
    [
      "-e",
      "if (typeof require('@prisma/client').PrismaClient !== 'function') process.exit(1)",
    ],
    {
      cwd: root,
      stdio: "ignore",
    },
  );
  record("Prisma client", "pass", "generated");
} catch {
  record("Prisma client", "fail", "not generated", "pnpm db:generate");
}

async function main() {
  // --- PostgreSQL ------------------------------------------------------------
  // Checked by opening a socket rather than by shelling out to psql: nobody
  // needs a local psql, and the only thing that matters is that the port the
  // app will connect to is actually answering.
  const dbUrl = existsSync(path.join(root, ".env"))
    ? (/^DATABASE_URL="?([^"\n]+)"?/m.exec(
        readFileSync(path.join(root, ".env"), "utf8"),
      )?.[1] ?? "")
    : "";
  const port = Number(/:(\d+)\//.exec(dbUrl)?.[1] ?? 5433);
  function portAnswering(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = net.connect({ host: "127.0.0.1", port });
      const done = (ok: boolean) => {
        socket.destroy();
        resolve(ok);
      };
      socket.setTimeout(2000);
      socket.on("connect", () => done(true));
      socket.on("timeout", () => done(false));
      socket.on("error", () => done(false));
    });
  }
  const reachable = await portAnswering(port);
  // Docker is only ever a means to this end, so it is reported as an
  // explanation for an unreachable database rather than as a requirement of
  // its own -- plenty of setups reach a Postgres this process cannot see a
  // Docker socket for, and failing those would be simply wrong.
  const dockerVersion = run("docker", ["--version"])
    ?.replace("Docker version ", "v")
    .split(",")[0];
  const daemonUp = Boolean(run("docker", ["info", "--format", "{{.ServerVersion}}"]));

  if (reachable) {
    record("PostgreSQL", "pass", `answering on localhost:${port}`);
    record(
      "Docker",
      daemonUp ? "pass" : "warn",
      daemonUp
        ? (dockerVersion ?? "running")
        : "not reachable from this shell, but the database is up, so nothing to do",
    );
  } else if (!dockerVersion) {
    record(
      "PostgreSQL",
      "fail",
      `nothing listening on localhost:${port}`,
      "Install Docker Desktop, then: docker compose up -d",
    );
    record(
      "Docker",
      "fail",
      "not installed -- it is how the local PostgreSQL runs",
      "Install Docker Desktop",
    );
  } else if (!daemonUp) {
    record(
      "PostgreSQL",
      "fail",
      `nothing listening on localhost:${port}`,
      "Start Docker Desktop, then: docker compose up -d",
    );
    record(
      "Docker",
      "fail",
      "installed, but the daemon is not running",
      "Start Docker Desktop",
    );
  } else {
    record(
      "PostgreSQL",
      "fail",
      `nothing listening on localhost:${port}`,
      "docker compose up -d",
    );
    record("Docker", "pass", dockerVersion);
  }

  // --- .env ------------------------------------------------------------------
  const envPath = path.join(root, ".env");
  if (!existsSync(envPath)) {
    record(
      ".env",
      "fail",
      "missing",
      windows ? "Copy-Item .env.example .env" : "cp .env.example .env",
    );
  } else {
    const env = readFileSync(envPath, "utf8");
    const required = ["DATABASE_URL", "AUTH_SECRET", "APP_BASE_URL"];
    const missing = required.filter((k) => !new RegExp(`^${k}=`, "m").test(env));
    if (missing.length) {
      record(
        ".env",
        "fail",
        `missing ${missing.join(", ")}`,
        "Compare against .env.example",
      );
    } else if (/AUTH_SECRET="?replace-with/.test(env)) {
      record(
        ".env",
        "fail",
        "AUTH_SECRET is still the placeholder from .env.example",
        `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`,
      );
    } else {
      record(".env", "pass", `${required.length} required keys present`);
    }
  }

  // --- Playwright browsers ---------------------------------------------------
  // Playwright pins exact browser builds per release, so "chromium is
  // installed" is not enough -- it has to be the build this version wants.
  const pwVersion = run("pnpm", ["exec", "playwright", "--version"])?.replace(
    "Version ",
    "",
  );
  if (!pwVersion) {
    record("Playwright", "fail", "not installed", "pnpm install");
  } else {
    const dryRun = run("pnpm", [
      "exec",
      "playwright",
      "install",
      "--dry-run",
      "chromium",
    ]);
    // Playwright pins an exact browser build per release, so the check has to
    // be for THAT build. A newer chromium left behind by a different project's
    // Playwright does not count, and silently does not work.
    const installPath = /Install location:\s*(.+)/.exec(dryRun ?? "")?.[1]?.trim();
    if (installPath && existsSync(installPath)) {
      record("Playwright", "pass", `v${pwVersion}, chromium present`);
    } else {
      record(
        "Playwright",
        "warn",
        `v${pwVersion} wants ${installPath ? path.basename(installPath) : "a browser build"}, which is not downloaded (only e2e needs it)`,
        "pnpm exec playwright install --with-deps chromium",
      );
    }
  }

  // --- Optional security tooling --------------------------------------------
  // CI runs each of these in a pinned container, so these are conveniences for
  // reproducing a CI finding locally, never a requirement to develop.
  // Install hints differ by platform. Where a Windows package name could not
  // be confirmed, the hint points at the project's releases page rather than
  // guessing one -- a wrong package name costs more time than a URL does.
  const optional: Array<[string, string[], string, string]> = [
    // pipx is the upstream-recommended install everywhere, Windows included.
    ["semgrep", ["--version"], "pnpm security:sast", "pipx install semgrep"],
    [
      "trivy",
      ["--version"],
      "pnpm security:container",
      windows ? "winget install AquaSecurity.Trivy" : "brew install trivy",
    ],
    [
      "osv-scanner",
      ["--version"],
      "pnpm security:sca",
      windows
        ? "https://github.com/google/osv-scanner/releases (grab the _windows_amd64.exe)"
        : "brew install osv-scanner",
    ],
    [
      "gitleaks",
      ["version"],
      "pnpm security:secrets",
      windows
        ? "https://github.com/gitleaks/gitleaks/releases (grab the _windows_x64.zip)"
        : "brew install gitleaks",
    ],
  ];
  for (const [tool, args, script, install] of optional) {
    const version = run(tool, args);
    if (version) {
      record(`${tool} (optional)`, "pass", version.split("\n")[0] ?? version);
    } else {
      record(
        `${tool} (optional)`,
        "warn",
        `not installed -- ${script} will not run locally`,
        install,
      );
    }
  }

  // --- Report ----------------------------------------------------------------
  const icon: Record<Status, string> = { pass: "PASS", warn: "WARN", fail: "FAIL" };
  const width = Math.max(...results.map((r) => r.name.length));

  console.log("\nservice-desk preflight\n");
  for (const r of results) {
    console.log(`  ${icon[r.status]}  ${r.name.padEnd(width)}  ${r.detail}`);
    if (r.fix && r.status !== "pass")
      console.log(`        ${" ".repeat(width)}  -> ${r.fix}`);
  }

  const failed = results.filter((r) => r.status === "fail");
  const warned = results.filter((r) => r.status === "warn");
  console.log("");
  if (failed.length) {
    console.log(
      `${failed.length} required check(s) failed. Fix the arrows above, then re-run pnpm preflight.\n`,
    );
    process.exit(1);
  }
  console.log(
    warned.length
      ? `Ready. ${warned.length} optional item(s) not set up -- fine unless you need them.\n`
      : "Ready.\n",
  );
}

void main();
