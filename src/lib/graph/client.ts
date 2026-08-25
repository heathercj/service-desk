import "server-only";
import { env } from "@/lib/env";

/**
 * App-only Microsoft Graph access (client-credentials grant), reusing the
 * same Entra app registration/secret the delegated sign-in flow already
 * uses -- just a different OAuth grant and different (Application, not
 * Delegated) permissions. See docs/ENTRA_SETUP.md for the permissions and
 * Exchange Application Access Policy this requires.
 *
 * Plain fetch rather than @azure/msal-node or the Graph SDK: a
 * client-credentials token plus a couple of REST calls doesn't need either
 * dependency, and src/lib/email/provider.ts already sets the precedent of
 * hand-rolling this kind of thing instead of pulling in an SDK.
 */

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

let cached: CachedToken | undefined;

async function getAppOnlyAccessToken(): Promise<string> {
  const now = Date.now();
  if (cached && cached.expiresAt - 60_000 > now) return cached.accessToken;

  const res = await fetch(
    `https://login.microsoftonline.com/${env.ENTRA_TENANT_ID}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: env.ENTRA_CLIENT_ID,
        client_secret: env.ENTRA_CLIENT_SECRET,
        scope: "https://graph.microsoft.com/.default",
        grant_type: "client_credentials",
      }),
    },
  );
  if (!res.ok) {
    throw new Error(`Failed to acquire a Graph app-only token: ${res.status}`);
  }
  const data = (await res.json()) as { access_token: string; expires_in: number };
  cached = { accessToken: data.access_token, expiresAt: now + data.expires_in * 1000 };
  return cached.accessToken;
}

/** Calls the Graph v1.0 API with an app-only bearer token. */
export async function graphFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const token = await getAppOnlyAccessToken();
  return fetch(`https://graph.microsoft.com/v1.0${path}`, {
    ...init,
    headers: {
      ...init.headers,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
}
