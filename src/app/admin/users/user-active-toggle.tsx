"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function UserActiveToggle({
  userId,
  isActive,
  isSelf,
}: {
  userId: string;
  isActive: boolean;
  isSelf: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  // An admin must never be offered a control that could lock them out of
  // their own account.
  if (isSelf) return null;

  async function toggle() {
    setBusy(true);
    try {
      await fetch(`/api/admin/users/${userId}/active`, {
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
