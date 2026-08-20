"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function DepartmentToggle({
  departmentId,
  isActive,
}: {
  departmentId: string;
  isActive: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function toggle() {
    setBusy(true);
    try {
      await fetch(`/api/admin/departments/${departmentId}/active`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !isActive }),
      });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      size="sm"
      variant={isActive ? "outline" : "default"}
      disabled={busy}
      onClick={toggle}
    >
      {isActive ? "Deactivate" : "Activate"}
    </Button>
  );
}
