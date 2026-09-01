"use client";

import Link from "next/link";
import { signOut } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { Wordmark, ApexBadge } from "@/components/wordmark";

interface SiteNavProps {
  auth: { displayName: string; roles: string[] } | null;
}

export function SiteNav({ auth }: SiteNavProps) {
  if (!auth) {
    return (
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <Link href="/">
              <Wordmark />
            </Link>
            <ApexBadge />
          </div>
        </div>
      </header>
    );
  }

  const roles = new Set(auth.roles);
  const links: Array<{ href: string; label: string }> = [];

  if (roles.has("CUSTOMER")) links.push({ href: "/dashboard", label: "My tickets" });
  if (roles.has("TRIAGE_AGENT") || roles.has("ADMINISTRATOR"))
    links.push({ href: "/triage", label: "Triage" });
  if (
    roles.has("DEPARTMENT_AGENT") ||
    roles.has("DEPARTMENT_MANAGER") ||
    roles.has("ADMINISTRATOR")
  ) {
    links.push({ href: "/queue", label: "My department" });
  }
  if (
    roles.has("TRIAGE_AGENT") ||
    roles.has("DEPARTMENT_AGENT") ||
    roles.has("DEPARTMENT_MANAGER") ||
    roles.has("ADMINISTRATOR")
  ) {
    links.push({ href: "/search", label: "Search tickets" });
  }
  if (roles.has("KNOWLEDGE_MANAGER") || roles.has("ADMINISTRATOR")) {
    links.push({ href: "/knowledge/manage", label: "Knowledge" });
  }
  if (roles.has("ADMINISTRATOR")) links.push({ href: "/admin", label: "Admin" });
  if (
    roles.has("DEPARTMENT_MANAGER") ||
    roles.has("KNOWLEDGE_MANAGER") ||
    roles.has("PRODUCT_MANAGER") ||
    roles.has("ADMINISTRATOR")
  ) {
    links.push({ href: "/reports", label: "Reports" });
  }
  if (
    roles.has("TRIAGE_AGENT") ||
    roles.has("DEPARTMENT_AGENT") ||
    roles.has("DEPARTMENT_MANAGER") ||
    roles.has("KNOWLEDGE_MANAGER") ||
    roles.has("ADMINISTRATOR")
  ) {
    links.push({ href: "/settings/notifications", label: "Notification settings" });
  }
  links.push({ href: "/dev-mailbox", label: "Dev mailbox" });

  return (
    <header className="border-b border-border">
      <nav
        aria-label="Primary"
        className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8"
      >
        <div className="flex items-center gap-3">
          <Link href="/">
            <Wordmark />
          </Link>
          <ApexBadge />
        </div>
        <ul className="flex flex-wrap items-center gap-4 text-sm">
          {links.map((link) => (
            <li key={link.href}>
              <Link
                href={link.href}
                className="text-muted-foreground hover:text-foreground hover:underline"
              >
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">{auth.displayName}</span>
          <ThemeToggle />
          <Button
            variant="outline"
            size="sm"
            onClick={() => signOut({ callbackUrl: "/login" })}
          >
            Sign out
          </Button>
        </div>
      </nav>
    </header>
  );
}
