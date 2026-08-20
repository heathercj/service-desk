import NextAuth, { type NextAuthConfig } from "next-auth";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import Credentials from "next-auth/providers/credentials";
import { env } from "@/lib/env";
import { db } from "@/lib/db";
import { findDevIdentity } from "@/lib/dev-auth/dev-identities";
import { isTenantClaimValid } from "@/lib/auth/tenant-validation";

// --- Module augmentation: what we actually put on the token/session. -------
// Only immutable identifiers ever live here. Roles and department
// memberships are intentionally NOT included -- every authorization check
// re-reads them from the database at request time (Section 3: "Never trust
// roles ... supplied by the browser").
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      entraObjectId: string;
      entraTenantId: string;
      isDevAccount: boolean;
      name?: string | null;
      email?: string | null;
    };
  }
}

// We deliberately do NOT ambient-augment "next-auth/jwt" here (it re-exports
// from "@auth/core/jwt", and augmenting a re-export module is unreliable
// across next-auth versions). Instead we cast to this local shape at the
// handful of read/write sites below.
interface AppJWT {
  internalUserId?: string;
  entraObjectId?: string;
  entraTenantId?: string;
  isDevAccount?: boolean;
}

interface EntraProfile {
  sub: string;
  oid?: string;
  tid?: string;
  email?: string;
  name?: string;
  preferred_username?: string;
}

const providers: NextAuthConfig["providers"] = [
  MicrosoftEntraID({
    issuer: `https://login.microsoftonline.com/${env.ENTRA_TENANT_ID}/v2.0`,
    clientId: env.ENTRA_CLIENT_ID,
    clientSecret: env.ENTRA_CLIENT_SECRET,
    // Least-privilege scopes (Section 3): no Graph access beyond the ID
    // token itself. We deliberately do not request User.Read.
    authorization: { params: { scope: "openid profile email" } },
    profile(profile: EntraProfile) {
      return {
        id: profile.oid ?? profile.sub,
        oid: profile.oid ?? profile.sub,
        tid: profile.tid ?? "",
        email: profile.email ?? profile.preferred_username ?? "",
        name: profile.name ?? "",
      };
    },
  }),
];

if (env.ENABLE_DEV_AUTH) {
  providers.push(
    Credentials({
      id: "dev-credentials",
      name: "Development sign-in",
      credentials: {
        devUserKey: { label: "Seeded identity", type: "text" },
      },
      async authorize(credentials) {
        const key =
          typeof credentials?.devUserKey === "string" ? credentials.devUserKey : "";
        const identity = findDevIdentity(key);
        if (!identity) return null;

        // Dev identities must already exist from `pnpm db:seed`. We do not
        // create them here so ENABLE_DEV_AUTH can never silently conjure a
        // privileged account outside the audited seed process.
        const user = await db.user.findUnique({
          where: { entraObjectId: identity.entraObjectId },
        });
        if (!user || !user.isDevAccount || !user.isActive) return null;

        return {
          id: user.id,
          oid: user.entraObjectId,
          tid: user.entraTenantId,
          email: user.email,
          name: user.displayName,
        };
      },
    }),
  );
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers,
  session: { strategy: "jwt", maxAge: 8 * 60 * 60 },
  pages: { signIn: "/login", error: "/login" },
  trustHost: true,
  secret: env.AUTH_SECRET,
  cookies: {
    sessionToken: {
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: env.NODE_ENV === "production",
      },
    },
  },
  callbacks: {
    async signIn({ account, profile, user }) {
      if (account?.provider === "microsoft-entra-id") {
        const tid = (profile as EntraProfile | undefined)?.tid;
        // Section 3: reject any identity whose tenant claim does not match
        // ENTRA_TENANT_ID, even though the issuer URL is already
        // tenant-scoped -- defence in depth against token substitution.
        return isTenantClaimValid(tid, env.ENTRA_TENANT_ID);
      }
      if (account?.provider === "dev-credentials") {
        return Boolean(user);
      }
      return false;
    },
    async jwt({ token, user, account }) {
      const appToken = token as AppJWT;

      if (user && account) {
        const oid = (user as { oid?: string }).oid;
        const tid = (user as { tid?: string }).tid;
        if (!oid) return token;

        let dbUser = await db.user.findUnique({ where: { entraObjectId: oid } });

        if (account.provider === "microsoft-entra-id") {
          // Tenant members and guest/partner accounts both authenticate
          // through this same tenant-scoped issuer, so both are permitted;
          // we only upsert profile display fields, never roles.
          dbUser = await db.user.upsert({
            where: { entraObjectId: oid },
            update: { email: user.email ?? "", displayName: user.name ?? "" },
            create: {
              entraObjectId: oid,
              entraTenantId: tid ?? env.ENTRA_TENANT_ID,
              email: user.email ?? "",
              displayName: user.name ?? "",
              isDevAccount: false,
            },
          });
        }

        if (!dbUser || !dbUser.isActive) {
          // Deny silently by clearing the token; middleware/session checks
          // treat a token without internalUserId as unauthenticated.
          delete appToken.internalUserId;
          return token;
        }

        appToken.internalUserId = dbUser.id;
        appToken.entraObjectId = dbUser.entraObjectId;
        appToken.entraTenantId = dbUser.entraTenantId;
        appToken.isDevAccount = dbUser.isDevAccount;
      }
      return token;
    },
    async session({ session, token }) {
      const appToken = token as AppJWT;
      if (!appToken.internalUserId) {
        // No valid internal user resolved -- surface as unauthenticated.
        return { ...session, user: undefined as never };
      }
      // Cast needed: next-auth's beta Session["user"] type intersects with
      // AdapterUser even though we don't configure a database adapter
      // (Section 3 -- we intentionally use JWT sessions, see module header
      // comment). The object we build here is what actually reaches
      // getAuthContext(); it deliberately carries no roles or department
      // data, only immutable identifiers.
      session.user = {
        id: appToken.internalUserId,
        entraObjectId: appToken.entraObjectId ?? "",
        entraTenantId: appToken.entraTenantId ?? "",
        isDevAccount: appToken.isDevAccount ?? false,
        name: session.user?.name,
        email: session.user?.email,
      } as typeof session.user;
      return session;
    },
  },
});
