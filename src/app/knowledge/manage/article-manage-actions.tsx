"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function ArticleManageActions({
  articleId,
  status,
  internalOnly,
}: {
  articleId: string;
  status: string;
  internalOnly: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function act(action: "publish" | "archive" | "restore") {
    setBusy(true);
    try {
      await fetch(`/api/knowledge/articles/${articleId}/${action}`, { method: "POST" });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function toggleVisibility() {
    setBusy(true);
    try {
      await fetch(`/api/knowledge/articles/${articleId}/visibility`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ internalOnly: !internalOnly }),
      });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex gap-2">
      {(status === "DRAFT" || status === "IN_REVIEW") && (
        <Button
          size="sm"
          data-tour="article-publish"
          disabled={busy}
          onClick={() => act("publish")}
        >
          Publish
        </Button>
      )}
      {status !== "ARCHIVED" && (
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => act("archive")}
        >
          Archive
        </Button>
      )}
      {status === "ARCHIVED" && (
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => act("restore")}
        >
          Restore
        </Button>
      )}
      <Button size="sm" variant="outline" disabled={busy} onClick={toggleVisibility}>
        {internalOnly ? "Make public" : "Mark internal only"}
      </Button>
    </div>
  );
}
