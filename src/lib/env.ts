import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_BASE_URL: z.string().url().default("http://localhost:3000"),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  AUTH_SECRET: z.string().min(1, "AUTH_SECRET is required"),
  AUTH_URL: z.string().url().optional(),

  ENTRA_TENANT_ID: z.string().min(1, "ENTRA_TENANT_ID is required"),
  ENTRA_CLIENT_ID: z.string().optional().default(""),
  ENTRA_CLIENT_SECRET: z.string().optional().default(""),

  ENABLE_DEV_AUTH: z
    .string()
    .optional()
    .transform((v) => v === "true"),

  // The guided demo tour ("Henry"). Signs itself in as seeded dev
  // identities to walk the golden path, so it is useless without dev auth
  // and is refused in production for the same reason -- see the guard below.
  ENABLE_DEMO_TOUR: z
    .string()
    .optional()
    .transform((v) => v === "true"),

  OBJECT_STORAGE_ROOT: z.string().default("./storage/uploads"),
  OBJECT_STORAGE_MAX_FILE_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(10 * 1024 * 1024),
  OBJECT_STORAGE_MAX_TOTAL_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(50 * 1024 * 1024),

  EMAIL_PROVIDER: z.enum(["console"]).default("console"),
  AI_PROVIDER: z.enum(["local"]).default("local"),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(30),

  // The sign-in limit is separate from the general one and much tighter,
  // because it is the one guarding credential stuffing (Section 15).
  //
  // It is configurable for one reason: the e2e suite. Middleware keys the
  // bucket on x-forwarded-for, which localhost never sets, so every
  // Playwright worker shares the single bucket `auth:unknown` -- and the
  // suite signs in around thirty times, because that is how it hands a
  // ticket between roles. Past the twentieth the sign-in POST comes back
  // 429, next-auth returns to /login, and the spec that lost the race looks
  // like a mystery timeout. See "Known flake" in docs/TESTING.md; twenty a
  // minute is right for humans and wrong for a parallel suite from one IP.
  RATE_LIMIT_AUTH_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_AUTH_MAX: z.coerce.number().int().positive().default(20),
});

export type AppEnv = z.infer<typeof envSchema>;

function loadEnv(): AppEnv {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `- ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  // Section 3: development authentication must NEVER be permitted alongside
  // NODE_ENV=production. This is a hard startup failure, not a warning.
  //
  // `next build` unconditionally sets NODE_ENV=production for the build
  // step itself (regardless of .env), which would otherwise make it
  // impossible to ever produce a build that *runs* with dev auth enabled --
  // including the CI DAST workflow, which the spec explicitly requires to
  // "launch the application using development authentication". We only
  // enforce this guard outside the build phase, i.e. at actual server
  // start (`next start` / `node server.js`), which is the point that
  // actually matters for this check.
  const isBuildPhase = process.env.NEXT_PHASE === "phase-production-build";
  if (
    parsed.data.ENABLE_DEV_AUTH &&
    parsed.data.NODE_ENV === "production" &&
    !isBuildPhase
  ) {
    throw new Error(
      "Refusing to start: ENABLE_DEV_AUTH=true is not allowed when NODE_ENV=production. " +
        "Development authentication must never run in a production environment.",
    );
  }

  if (
    parsed.data.ENABLE_DEMO_TOUR &&
    parsed.data.NODE_ENV === "production" &&
    !isBuildPhase
  ) {
    throw new Error(
      "Refusing to start: ENABLE_DEMO_TOUR=true is not allowed when NODE_ENV=production. " +
        "The guided tour drives the UI as seeded development identities.",
    );
  }

  // The tour signs itself in as dev identities, so on its own it would be a
  // guided walk into a login wall.
  if (parsed.data.ENABLE_DEMO_TOUR && !parsed.data.ENABLE_DEV_AUTH) {
    throw new Error(
      "Refusing to start: ENABLE_DEMO_TOUR=true requires ENABLE_DEV_AUTH=true.",
    );
  }

  return parsed.data;
}

export const env = loadEnv();
