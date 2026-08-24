import type { Metadata } from "next";
import "./globals.css";
import { env } from "@/lib/env";
import { getAuthContext } from "@/lib/auth/session";
import { SiteNav } from "@/components/site-nav";
import { ThemeProvider } from "@/components/theme-provider";
import { DemoGuide } from "@/components/demo/demo-guide";

export const metadata: Metadata = {
  title: "Service Desk",
  description: "Internal service desk ticket management prototype",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const auth = await getAuthContext();

  return (
    // suppressHydrationWarning is required by next-themes: it sets the
    // theme class on <html> before React hydrates, so the server markup
    // and the first client render legitimately differ on that attribute.
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-background font-sans antialiased">
        <ThemeProvider>
          {/* No dev-auth banner. It said nothing the login page does not already
              say plainly -- the development sign-in card is right there, warning
              coloured, naming the flag -- and src/lib/env.ts refuses to boot with
              the flag set in production, so the build it warned about cannot
              exist. What it did do was sit above every page in every demo and
              every screenshot. */}
          <SiteNav
            auth={
              auth
                ? { displayName: auth.displayName, roles: Array.from(auth.roles) }
                : null
            }
          />
          <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">{children}</main>
          {/* Offers itself and otherwise stays out of the way -- nothing
              starts until someone presses Start. */}
          {env.ENABLE_DEMO_TOUR && <DemoGuide signedInAs={auth?.displayName ?? null} />}
        </ThemeProvider>
      </body>
    </html>
  );
}
