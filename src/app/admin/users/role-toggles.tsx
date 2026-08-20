"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function RoleToggles({
  userId,
  currentRoles,
  allRoles,
}: {
  userId: string;
  currentRoles: string[];
  allRoles: string[];
}) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const roleSet = new Set(currentRoles);

  async function toggle(role: string, enabled: boolean) {
    setPending(role);
    try {
      await fetch(`/api/admin/users/${userId}/role`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role, enabled }),
      });
      router.refresh();
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="flex flex-wrap gap-3 text-xs">
      {allRoles.map((role) => (
        <label key={role} className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={roleSet.has(role)}
            disabled={pending === role}
            onChange={(e) => toggle(role, e.target.checked)}
          />
          {role}
        </label>
      ))}
    </div>
  );
}
