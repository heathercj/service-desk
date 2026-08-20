"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";

interface ChatTurn {
  question: string;
  answerText: string;
  citations: Array<{ articleId: string; title: string; internalUrl: string }>;
}

/**
 * Retrieval-only knowledge assistant (Section 6). Every answer is templated
 * from deterministic full-text search over published articles only -- see
 * /api/chat and src/lib/ai/local-provider.ts.
 */
export function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [busy, setBusy] = useState(false);

  async function ask() {
    if (!question.trim()) return;
    setBusy(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });
      const data = await res.json();
      setTurns((prev) => [
        ...prev,
        { question, answerText: data.answerText, citations: data.citations ?? [] },
      ]);
      setQuestion("");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button variant="outline" onClick={() => setOpen(true)}>
        Ask the knowledge assistant
      </Button>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-base">Knowledge assistant</CardTitle>
          <CardDescription>
            Answers only from published articles. It will say so if it doesn&apos;t know,
            and never invents ticket status or policy.
          </CardDescription>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Close
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="max-h-64 space-y-3 overflow-y-auto">
          {turns.map((t, i) => (
            <div key={i} className="space-y-1 text-sm">
              <p className="font-medium">You: {t.question}</p>
              <p className="whitespace-pre-wrap rounded-md border border-border bg-muted p-2">
                {t.answerText}
              </p>
              {t.citations.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Sources:{" "}
                  {t.citations.map((c, idx) => (
                    <span key={c.articleId}>
                      <Link href={c.internalUrl} className="underline">
                        {c.title}
                      </Link>
                      {idx < t.citations.length - 1 ? ", " : ""}
                    </span>
                  ))}
                </p>
              )}
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <Input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && ask()}
            placeholder="e.g. How do I reset my VPN?"
          />
          <Button disabled={busy} onClick={ask}>
            {busy ? "Asking..." : "Ask"}
          </Button>
        </div>
        <Button variant="link" asChild className="h-auto px-0 text-xs">
          <Link href="/tickets/new">Still need help? Create a ticket instead</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
