"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Light/dark switch for the site header.
 *
 * `resolvedTheme` is only known on the client, so rendering the real icon
 * before mount would produce a server/client mismatch and a hydration
 * warning. Until mounted we render the same-sized button with no icon, which
 * keeps the header from shifting.
 */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const isDark = resolvedTheme === "dark";

  return (
    <Button
      variant="outline"
      size="sm"
      aria-label={
        mounted ? `Switch to ${isDark ? "light" : "dark"} theme` : "Switch theme"
      }
      onClick={() => setTheme(isDark ? "light" : "dark")}
    >
      {mounted ? (
        isDark ? (
          <Sun className="h-4 w-4" aria-hidden="true" />
        ) : (
          <Moon className="h-4 w-4" aria-hidden="true" />
        )
      ) : (
        <span className="block h-4 w-4" />
      )}
    </Button>
  );
}
