import { env } from "@/lib/env";
import { DEV_IDENTITIES } from "@/lib/dev-auth/dev-identities";
import { LoginForm } from "./login-form";

export default function LoginPage() {
  const devIdentities = env.ENABLE_DEV_AUTH
    ? DEV_IDENTITIES.map((i) => ({
        key: i.key,
        displayName: i.displayName,
        roles: i.roles,
        description: i.description,
      }))
    : [];

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center gap-8 px-4">
      {/* No wordmark here: the header above is already the branded lockup, and
          this is the one page a signed-out visitor ever sees it on -- two of
          them, badge and all, within eighty pixels read as a mistake. */}
      <div className="text-center">
        <h1 className="text-2xl font-semibold">Sign in</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Use your Alair Homes account to continue.
        </p>
      </div>
      <LoginForm devEnabled={env.ENABLE_DEV_AUTH} devIdentities={devIdentities} />
    </div>
  );
}
