"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function CreateDepartmentForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/departments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "Something went wrong.");
        return;
      }
      setName("");
      setCreated(true);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-2">
      <div>
        <Label htmlFor="create-department-name">Department name</Label>
        <Input
          id="create-department-name"
          required
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setCreated(false);
          }}
          placeholder="Alair Performance Team"
          className="mt-1"
        />
      </div>
      <Button type="submit" disabled={busy}>
        Create
      </Button>
      {error && (
        <p role="alert" className="w-full text-sm text-destructive">
          {error}
        </p>
      )}
      {created && (
        <p className="w-full text-sm text-muted-foreground">
          Department created. Assign staff to it on the{" "}
          <a href="/admin/users" className="underline">
            Users
          </a>{" "}
          page -- it starts with no members.
        </p>
      )}
    </form>
  );
}
