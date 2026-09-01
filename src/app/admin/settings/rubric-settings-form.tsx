"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Rubric } from "@/lib/reports/rubric-settings-service";

const PRIORITY_FIELDS = [
  { key: "URGENT", label: "Urgent target hours" },
  { key: "HIGH", label: "High target hours" },
  { key: "MEDIUM", label: "Medium target hours" },
  { key: "LOW", label: "Low target hours" },
] as const;

export function RubricSettingsForm({ rubric }: { rubric: Rubric }) {
  const router = useRouter();
  const [targetHoursByPriority, setTargetHoursByPriority] = useState(
    rubric.targetHoursByPriority,
  );
  const [graceHours, setGraceHours] = useState(rubric.graceHours);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/settings/rubric", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetHoursByPriority, graceHours }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "Something went wrong.");
        setSaved(false);
        return;
      }
      setSaved(true);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {PRIORITY_FIELDS.map((f) => (
          <div key={f.key}>
            <Label htmlFor={`rubric-${f.key}`}>{f.label}</Label>
            <Input
              id={`rubric-${f.key}`}
              type="number"
              min={1}
              required
              value={targetHoursByPriority[f.key]}
              onChange={(e) => {
                setSaved(false);
                setTargetHoursByPriority((prev) => ({
                  ...prev,
                  [f.key]: Number(e.target.value),
                }));
              }}
              className="mt-1"
            />
          </div>
        ))}
        <div>
          <Label htmlFor="rubric-grace-hours">Grace period hours</Label>
          <Input
            id="rubric-grace-hours"
            type="number"
            min={1}
            required
            value={graceHours}
            onChange={(e) => {
              setSaved(false);
              setGraceHours(Number(e.target.value));
            }}
            className="mt-1"
          />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button type="submit" disabled={busy}>
          Save
        </Button>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {saved && <p className="text-sm text-muted-foreground">Saved.</p>}
      </div>
    </form>
  );
}
