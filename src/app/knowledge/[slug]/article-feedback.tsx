"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

export function ArticleFeedback({ articleId }: { articleId: string }) {
  const [sent, setSent] = useState<boolean | null>(null);

  if (sent !== null) {
    return <p className="text-sm text-muted-foreground">Thanks for the feedback!</p>;
  }

  async function send(wasHelpful: boolean) {
    setSent(wasHelpful);
    await fetch("/api/knowledge/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ articleId, wasHelpful }),
    }).catch(() => undefined);
  }

  return (
    <div className="flex items-center gap-2 border-t border-border pt-4 text-sm">
      <span>Was this helpful?</span>
      <Button size="sm" variant="outline" onClick={() => send(true)}>
        Yes
      </Button>
      <Button size="sm" variant="outline" onClick={() => send(false)}>
        No
      </Button>
    </div>
  );
}
