"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { DEPARTMENT_KEYS } from "@/lib/validation/ticket-schemas";
import { Select } from "@/components/ui/select";

interface SimilarArticle {
  articleId: string;
  title: string;
  summary: string;
  status: string;
  matchReasons: string[];
}

export function KnowledgeOutcomePanel({
  ticketId,
  ticketSubject,
  ticketDescription,
  departmentKey,
  canRecordException,
}: {
  ticketId: string;
  ticketSubject: string;
  ticketDescription: string;
  departmentKey: string;
  canRecordException: boolean;
}) {
  const router = useRouter();
  const [results, setResults] = useState<SimilarArticle[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDraftForm, setShowDraftForm] = useState(false);
  const [draftTitle, setDraftTitle] = useState(ticketSubject);
  const [draftSummary, setDraftSummary] = useState("");
  const [draftBody, setDraftBody] = useState("");
  const [draftDept, setDraftDept] = useState(departmentKey);
  const [draftInternalOnly, setDraftInternalOnly] = useState(false);
  const [exceptionReason, setExceptionReason] = useState("");
  const [showException, setShowException] = useState(false);

  async function runCheck() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/knowledge/similar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          proposedTitle: ticketSubject,
          proposedSummary: ticketDescription.slice(0, 300),
          departmentKey,
          ticketId,
        }),
      });
      const data = await res.json();
      setResults(data.results ?? []);
    } catch {
      setError("Could not run the similarity check.");
    } finally {
      setBusy(false);
    }
  }

  async function recordOutcome(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/tickets/${ticketId}/knowledge-outcome`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Could not record knowledge outcome");
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          Knowledge check (required before resolving)
        </CardTitle>
        <CardDescription>
          Search for an existing article before creating a new one, or record why none
          applies.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button
          data-tour="knowledge-check-run"
          variant="outline"
          disabled={busy}
          onClick={runCheck}
        >
          {busy ? "Searching..." : "Run knowledge similarity check"}
        </Button>

        {results && results.length === 0 && (
          <p className="text-sm text-muted-foreground">No similar articles found.</p>
        )}

        {results && results.length > 0 && (
          <ul className="space-y-2">
            {results.map((r) => (
              <li
                key={r.articleId}
                className="rounded-md border border-border p-3 text-sm"
              >
                <p className="font-medium">
                  {r.title}{" "}
                  <span className="text-xs text-muted-foreground">({r.status})</span>
                </p>
                <p className="text-muted-foreground">{r.summary}</p>
                <p className="text-xs text-muted-foreground">
                  Why: {r.matchReasons.join(", ")}
                </p>
                <div className="mt-2 flex gap-2">
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      recordOutcome({
                        articleId: r.articleId,
                        outcomeType: "LINKED_EXISTING",
                      })
                    }
                  >
                    Link this article
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      recordOutcome({
                        articleId: r.articleId,
                        outcomeType: "PROPOSED_UPDATE",
                      })
                    }
                  >
                    Propose an update
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {results !== null && (
          <div className="space-y-2 border-t border-border pt-3">
            <Button
              size="sm"
              data-tour="knowledge-draft-toggle"
              variant="outline"
              onClick={() => setShowDraftForm((v) => !v)}
            >
              {showDraftForm
                ? "Hide new draft form"
                : "No suitable article -- create a new draft"}
            </Button>
            {showDraftForm && (
              <div className="space-y-2 rounded-md border border-border p-3">
                <label className="text-xs">
                  Title
                  <Input
                    data-tour="draft-title"
                    value={draftTitle}
                    onChange={(e) => setDraftTitle(e.target.value)}
                  />
                </label>
                <label className="text-xs">
                  Summary
                  <Textarea
                    data-tour="draft-summary"
                    value={draftSummary}
                    onChange={(e) => setDraftSummary(e.target.value)}
                    rows={2}
                  />
                </label>
                <label className="text-xs">
                  Department
                  <Select
                    value={draftDept}
                    onChange={(e) => setDraftDept(e.target.value)}
                  >
                    {DEPARTMENT_KEYS.map((k) => (
                      <option key={k} value={k}>
                        {k.replaceAll("_", " ")}
                      </option>
                    ))}
                  </Select>
                </label>
                <label className="text-xs">
                  Article body (Markdown)
                  <Textarea
                    data-tour="draft-body"
                    value={draftBody}
                    onChange={(e) => setDraftBody(e.target.value)}
                    rows={6}
                  />
                </label>
                <label className="flex items-center gap-2 text-xs">
                  <input
                    data-tour="draft-internal-only"
                    type="checkbox"
                    checked={draftInternalOnly}
                    onChange={(e) => setDraftInternalOnly(e.target.checked)}
                  />
                  Internal only -- never shown to customers (deflection suggestions or
                  direct article links)
                </label>
                <Button
                  size="sm"
                  data-tour="draft-create"
                  disabled={busy || !draftSummary.trim() || draftBody.trim().length < 20}
                  onClick={async () => {
                    setBusy(true);
                    setError(null);
                    try {
                      const res = await fetch("/api/knowledge/articles", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          title: draftTitle,
                          summary: draftSummary,
                          departmentKey: draftDept,
                          tags: [],
                          body: draftBody,
                          sourceTicketId: ticketId,
                          similarityCandidateArticleIds:
                            results?.map((r) => r.articleId) ?? [],
                          internalOnly: draftInternalOnly,
                        }),
                      });
                      if (!res.ok) {
                        const data = await res.json().catch(() => ({}));
                        throw new Error(data.error ?? "Could not create draft");
                      }
                      const data = await res.json();
                      await recordOutcome({
                        articleId: data.articleId,
                        outcomeType: "NEW_DRAFT",
                      });
                    } catch (err) {
                      setError(
                        err instanceof Error ? err.message : "Something went wrong",
                      );
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Create draft &amp; record outcome
                </Button>
              </div>
            )}
          </div>
        )}

        {canRecordException && results !== null && (
          <div className="space-y-2 border-t border-border pt-3">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowException((v) => !v)}
            >
              {showException ? "Hide exception form" : "Record a documented exception"}
            </Button>
            {showException && (
              <div className="space-y-2 rounded-md border border-border p-3">
                <label className="text-xs">
                  Reason (required)
                  <Textarea
                    value={exceptionReason}
                    onChange={(e) => setExceptionReason(e.target.value)}
                    rows={2}
                  />
                </label>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || !exceptionReason.trim()}
                  onClick={() =>
                    recordOutcome({ outcomeType: "EXCEPTION", reason: exceptionReason })
                  }
                >
                  Record exception
                </Button>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
