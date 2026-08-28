"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface DepartmentOption {
  id: string;
  name: string;
}

export interface CurrentMembership {
  departmentId: string;
  isManager: boolean;
}

export function DepartmentMembershipToggles({
  userId,
  currentMemberships,
  allDepartments,
}: {
  userId: string;
  currentMemberships: CurrentMembership[];
  allDepartments: DepartmentOption[];
}) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const managerByDepartment = new Map(
    currentMemberships.map((m) => [m.departmentId, m.isManager]),
  );

  async function update(departmentId: string, isMember: boolean, isManager: boolean) {
    setPending(departmentId);
    try {
      await fetch(`/api/admin/users/${userId}/departments/${departmentId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isMember, isManager }),
      });
      router.refresh();
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="flex flex-wrap gap-4 text-xs">
      {allDepartments.map((dept) => {
        const isMember = managerByDepartment.has(dept.id);
        const isManager = managerByDepartment.get(dept.id) ?? false;
        const busy = pending === dept.id;
        return (
          <div key={dept.id} className="flex items-center gap-2">
            <label className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={isMember}
                disabled={busy}
                onChange={(e) =>
                  update(dept.id, e.target.checked, e.target.checked ? isManager : false)
                }
              />
              {dept.name}
            </label>
            <label className="flex items-center gap-1 text-muted-foreground">
              <input
                type="checkbox"
                checked={isManager}
                disabled={busy || !isMember}
                onChange={(e) => update(dept.id, true, e.target.checked)}
              />
              Manager
            </label>
          </div>
        );
      })}
    </div>
  );
}
