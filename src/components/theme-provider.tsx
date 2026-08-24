"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

/**
 * Wires up class-based theming the way APEX does: next-themes with
 * `attribute="class"`, which puts `.dark` on <html> for the token block in
 * globals.css to key off.
 *
 * `defaultTheme="system"` means a first-time visitor gets their OS
 * preference, but the choice is still applied as a class -- the CSS itself
 * never consults prefers-color-scheme, so an explicit toggle always wins.
 * `disableTransitionOnChange` stops every themed element animating its
 * colour at once when the theme flips.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
