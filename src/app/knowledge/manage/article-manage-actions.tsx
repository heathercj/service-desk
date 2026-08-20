"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function ArticleManageActions({
  articleId,
  status,
}: {
  articleId: string;
  status: string;
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

  return (
    <div className="flex gap-2">
      {(status === "DRAFT" || status === "IN_REVIEW") && (
        <Button size="sm" disabled={busy} onClick={() => act("publish")}>
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
    </div>
  );
}
