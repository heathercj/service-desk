import type { Metadata } from "next";
import "./globals.css";
import { env } from "@/lib/env";
import { getAuthContext } from "@/lib/auth/session";
import { SiteNav } from "@/components/site-nav";

export const metadata: Metadata = {
  title: "Service Desk",
  description: "Internal service desk ticket management prototype",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const auth = await getAuthContext();

  return (
    <html lang="en">
      <body className="min-h-screen bg-background font-sans antialiased">
        {env.ENABLE_DEV_AUTH && (
          <div className="dev-auth-banner" role="alert">
            Development authentication is enabled (ENABLE_DEV_AUTH=true). This build must
            never be used in production.
          </div>
        )}
        <SiteNav
          auth={
            auth ? { displayName: auth.displayName, roles: Array.from(auth.roles) } : null
          }
        />
        <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </body>
    </html>
  );
}
