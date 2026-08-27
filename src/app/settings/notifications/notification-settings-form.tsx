"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

export interface NotificationPreferencesValue {
  ticketAssignedEmail: boolean;
  ticketCommentedEmail: boolean;
  knowledgeArticlePublishedEmail: boolean;
}

const TOGGLES: Array<{ key: keyof NotificationPreferencesValue; label: string }> = [
  { key: "ticketAssignedEmail", label: "Email me when a ticket is assigned to me" },
  {
    key: "ticketCommentedEmail",
    label: "Email me when a customer comments on a ticket assigned to me",
  },
  {
    key: "knowledgeArticlePublishedEmail",
    label: "Email me when a knowledge article is published",
  },
];

export function NotificationSettingsForm({
  initialPreferences,
}: {
  initialPreferences: NotificationPreferencesValue;
}) {
  const [preferences, setPreferences] =
    useState<NotificationPreferencesValue>(initialPreferences);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setSaved(false);
    try {
      await fetch("/api/settings/notifications", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(preferences),
      });
      setSaved(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="max-w-md space-y-4">
      {TOGGLES.map(({ key, label }) => (
        <div key={key} className="flex items-center gap-2">
          <input
            id={key}
            type="checkbox"
            checked={preferences[key]}
            onChange={() => setPreferences((prev) => ({ ...prev, [key]: !prev[key] }))}
            className="h-4 w-4 rounded border-input"
          />
          <Label htmlFor={key}>{label}</Label>
        </div>
      ))}
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={busy}>
          Save
        </Button>
        {saved && (
          <span role="status" className="text-sm text-muted-foreground">
            Saved.
          </span>
        )}
      </div>
    </form>
  );
}
