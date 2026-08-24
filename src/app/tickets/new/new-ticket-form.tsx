"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { z } from "zod";
import {
  createTicketObjectSchema,
  createTicketSchema,
  MIN_DESCRIPTION_LENGTH,
} from "@/lib/validation/ticket-schemas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";

// `isProjectRelated` is deliberately NOT registered with react-hook-form:
// RHF's `setValueAs` on a native radio group does not reliably coerce the
// checked radio's string value to a boolean before zodResolver validates
// it (observed live as "Expected boolean, received string"). Plain local
// state for this one field is simpler and correct.
const formSchema = createTicketObjectSchema.omit({
  urls: true,
  attemptedArticleIds: true,
  isProjectRelated: true,
});
type FormValues = z.infer<typeof formSchema>;

// Mirrors the server-side limits in attachment-policy.ts. This is just for
// snappy client feedback -- uploadAttachment() re-enforces everything.
const MAX_SCREENSHOTS = 8;
const MAX_SCREENSHOT_BYTES = 10 * 1024 * 1024;

async function uploadScreenshot(ticketId: string, file: File) {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`/api/tickets/${ticketId}/attachments`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Failed to upload ${file.name}`);
  }
}

interface Suggestion {
  articleId: string;
  title: string;
  summary: string;
  slug: string;
  matchReasons: string[];
}

export function NewTicketForm({
  franchises,
  submitterName,
  submitterEmail,
}: {
  franchises: Array<{ id: string; name: string }>;
  submitterName: string;
  submitterEmail: string;
}) {
  const router = useRouter();
  const [urlsText, setUrlsText] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [attemptedArticleIds, setAttemptedArticleIds] = useState<string[]>([]);
  const [isProjectRelated, setIsProjectRelated] = useState(false);
  const [deflected, setDeflected] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [screenshots, setScreenshots] = useState<File[]>([]);
  const [screenshotError, setScreenshotError] = useState<string | null>(null);
  const [createdTicketNumber, setCreatedTicketNumber] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    setFocus,
    formState: { errors, isSubmitted },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      franchiseId: franchises[0]?.id ?? "",
      subject: "",
      description: "",
      impact: "",
      urgencyNote: "",
      consentAcknowledged: false as unknown as true,
    },
  });

  const subject = watch("subject");
  const description = watch("description");

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      if (
        subject.trim().length < 3 &&
        description.trim().length < MIN_DESCRIPTION_LENGTH
      ) {
        setSuggestions([]);
        return;
      }
      try {
        const res = await fetch("/api/knowledge/suggestions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ subject, description }),
        });
        if (!res.ok) return;
        const data = await res.json();
        setSuggestions(data.suggestions ?? []);
      } catch {
        // Suggestions are a courtesy, not required for ticket submission.
      }
    }, 500);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [subject, description]);

  function onScreenshotsChange(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ""; // allow re-selecting the same file after removing it
    setScreenshotError(null);
    setScreenshots((prev) => {
      const accepted: File[] = [];
      for (const file of files) {
        if (prev.length + accepted.length >= MAX_SCREENSHOTS) {
          setScreenshotError(`You can attach up to ${MAX_SCREENSHOTS} screenshots.`);
          break;
        }
        if (file.size > MAX_SCREENSHOT_BYTES) {
          setScreenshotError(`"${file.name}" exceeds the 10 MB limit and was skipped.`);
          continue;
        }
        accepted.push(file);
      }
      return [...prev, ...accepted];
    });
  }

  function removeScreenshot(index: number) {
    setScreenshotError(null);
    setScreenshots((prev) => prev.filter((_, i) => i !== index));
  }

  const urlLines = useMemo(
    () =>
      urlsText
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean),
    [urlsText],
  );

  async function onSubmit(values: FormValues) {
    setSubmitError(null);
    setSubmitting(true);
    try {
      const parsed = createTicketSchema.safeParse({
        ...values,
        isProjectRelated,
        urls: urlLines,
        attemptedArticleIds,
      });
      if (!parsed.success) {
        setSubmitError(
          parsed.error.issues[0]?.message ?? "Please check the form for errors.",
        );
        return;
      }
      const res = await fetch("/api/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setSubmitError(body.error ?? "Could not submit ticket.");
        return;
      }
      const data = await res.json();

      if (screenshots.length > 0) {
        const results = await Promise.allSettled(
          screenshots.map((file) => uploadScreenshot(data.ticketId, file)),
        );
        const failedCount = results.filter((r) => r.status === "rejected").length;
        if (failedCount > 0) {
          setCreatedTicketNumber(data.ticketNumber);
          setSubmitError(
            `Ticket ${data.ticketNumber} was created, but ${failedCount} of ${screenshots.length} screenshot(s) failed to upload. Open the ticket below to try again.`,
          );
          return;
        }
      }
      router.push(`/tickets/${data.ticketNumber}`);
    } finally {
      setSubmitting(false);
    }
  }

  function onInvalid(formErrors: typeof errors) {
    // Section 18: "Provide accessible validation summaries." Field-level
    // messages alone aren't enough on a long form -- if the first invalid
    // field is scrolled out of view, clicking Submit otherwise looks like
    // it does nothing. Focusing the first invalid field scrolls it into
    // view natively; the summary below covers screen-reader users too.
    const firstField = Object.keys(formErrors)[0];
    if (firstField) {
      setFocus(firstField as keyof FormValues);
    }
  }

  if (deflected) {
    return (
      <Card className="mt-6" data-tour="deflected-confirmation">
        <CardHeader>
          <CardTitle>Glad that helped!</CardTitle>
          <CardDescription>
            We&apos;ve recorded that a knowledge article solved your issue -- no ticket
            was created.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={() => setDeflected(false)}>
            Actually, I still need help
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit, onInvalid)}
      className="mt-6 space-y-6"
      noValidate
    >
      {isSubmitted && Object.keys(errors).length > 0 && (
        <div
          role="alert"
          className="rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive"
        >
          <p className="font-medium">Please fix the following before submitting:</p>
          <ul className="mt-1 list-disc pl-5">
            {Object.entries(errors).map(([field, err]) => (
              <li key={field}>{String(err?.message ?? `${field} is invalid`)}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="submitterName">Name</Label>
          <Input id="submitterName" value={submitterName} disabled aria-readonly />
        </div>
        <div>
          <Label htmlFor="submitterEmail">Email</Label>
          <Input id="submitterEmail" value={submitterEmail} disabled aria-readonly />
        </div>
      </div>

      <div>
        <Label htmlFor="franchiseId">Franchise / work-with company</Label>
        <Select
          id="franchiseId"
          {...register("franchiseId")}
          aria-invalid={Boolean(errors.franchiseId)}
        >
          {franchises.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </Select>
        {errors.franchiseId && (
          <p className="mt-1 text-sm text-destructive">{errors.franchiseId.message}</p>
        )}
      </div>

      <div>
        <Label htmlFor="subject">Subject</Label>
        <Input
          id="subject"
          data-tour="ticket-subject"
          {...register("subject")}
          aria-invalid={Boolean(errors.subject)}
        />
        {errors.subject && (
          <p className="mt-1 text-sm text-destructive">{errors.subject.message}</p>
        )}
      </div>

      <div>
        <Label htmlFor="description">
          Describe the issue so that the technician can identify the process you were
          trying to complete, the action that is being prevented, and if possible, share
          any error messages you are seeing
        </Label>
        <Textarea
          id="description"
          data-tour="ticket-description"
          rows={6}
          // Names a tool nobody has to recognise, and models the three things
          // the label above asks for: what you were doing, what stopped, and
          // anything the screen said.
          placeholder={
            "e.g. I cannot sign into my email. I enter my password and the page " +
            "returns me to the sign-in screen without an error. The same password " +
            "works on my phone."
          }
          {...register("description")}
          aria-invalid={Boolean(errors.description)}
          aria-describedby="description-hint"
        />
        <p id="description-hint" className="mt-1 text-xs text-muted-foreground">
          At least {MIN_DESCRIPTION_LENGTH} characters. Do not include passwords,
          authentication tokens, or payment card details.
        </p>
        {errors.description && (
          <p className="mt-1 text-sm text-destructive">{errors.description.message}</p>
        )}
      </div>

      <div>
        <Label htmlFor="screenshots">Screenshots (optional)</Label>
        <input
          id="screenshots"
          type="file"
          accept=".png,.jpg,.jpeg,.webp,.gif"
          multiple
          onChange={onScreenshotsChange}
          className="block text-sm"
        />
        <p className="mt-1 text-xs text-muted-foreground">
          PNG, JPG, WEBP, or GIF -- up to 10 MB each, {MAX_SCREENSHOTS} total. Screenshots
          are scanned before staff can view them.
        </p>
        {screenshotError && (
          <p className="mt-1 text-sm text-destructive">{screenshotError}</p>
        )}
        {screenshots.length > 0 && (
          <ul className="mt-2 space-y-1">
            {screenshots.map((file, index) => (
              <li
                key={`${file.name}-${index}`}
                className="flex items-center justify-between gap-2 rounded-md border border-border px-2 py-1 text-sm"
              >
                <span className="truncate">{file.name}</span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => removeScreenshot(index)}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {suggestions.length > 0 && (
        <Card data-tour="suggestions-card">
          <CardHeader>
            <CardTitle className="text-base">This might already be answered</CardTitle>
            <CardDescription>Based on your subject and description.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {suggestions.map((s) => (
              <div
                key={s.articleId}
                data-tour="suggestion-row"
                className="rounded-md border border-border p-3"
              >
                <a
                  href={`/knowledge/${s.slug}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium hover:underline"
                  onClick={() =>
                    setAttemptedArticleIds((prev) =>
                      Array.from(new Set([...prev, s.articleId])),
                    )
                  }
                >
                  {s.title}
                </a>
                <p className="mt-1 text-sm text-muted-foreground">{s.summary}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Why: {s.matchReasons.join(", ")}
                </p>
                <div className="mt-2 flex gap-2">
                  <Button
                    type="button"
                    data-tour="deflect-solved"
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      await fetch("/api/knowledge/deflection", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ articleId: s.articleId }),
                      });
                      setDeflected(true);
                    }}
                  >
                    This solved it
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Is this related to a project?</legend>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name="isProjectRelated"
            checked={isProjectRelated}
            onChange={() => setIsProjectRelated(true)}
          />
          Yes
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name="isProjectRelated"
            checked={!isProjectRelated}
            onChange={() => setIsProjectRelated(false)}
          />
          No
        </label>
      </fieldset>

      {isProjectRelated && (
        <div>
          <Label htmlFor="projectNumber">Project number</Label>
          <Input
            id="projectNumber"
            placeholder="2026-0142"
            {...register("projectNumber")}
            aria-invalid={Boolean(errors.projectNumber)}
          />
          {errors.projectNumber && (
            <p className="mt-1 text-sm text-destructive">
              {errors.projectNumber.message}
            </p>
          )}
        </div>
      )}

      <div>
        <Label htmlFor="urls">Issue URLs (one per line, optional)</Label>
        <Textarea
          id="urls"
          rows={3}
          value={urlsText}
          onChange={(e) => setUrlsText(e.target.value)}
          placeholder="https://example.com/relevant-page"
        />
        <p className="mt-1 text-xs text-muted-foreground">
          Links will never be opened automatically by our systems -- only shown to staff
          as user-submitted references.
        </p>
      </div>

      <div>
        <Label htmlFor="impact">Impact</Label>
        <Input
          id="impact"
          {...register("impact")}
          placeholder="e.g. Blocks my ability to submit change orders"
        />
      </div>

      <div>
        <Label htmlFor="urgencyNote">Urgency (optional)</Label>
        <Input
          id="urgencyNote"
          {...register("urgencyNote")}
          placeholder="e.g. Client meeting tomorrow morning"
        />
      </div>

      <div className="rounded-md border border-border bg-muted p-4">
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            data-tour="ticket-consent"
            className="mt-1"
            {...register("consentAcknowledged")}
          />
          <span>
            I confirm this ticket does not contain passwords, authentication tokens,
            payment card data, or unnecessary personal information. Attachments will be
            scanned before they can be downloaded by staff.
          </span>
        </label>
        {errors.consentAcknowledged && (
          <p className="mt-1 text-sm text-destructive">
            {errors.consentAcknowledged.message}
          </p>
        )}
      </div>

      {submitError && (
        <p
          role="alert"
          className="rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive"
        >
          {submitError}{" "}
          {createdTicketNumber && (
            <a href={`/tickets/${createdTicketNumber}`} className="underline">
              Open ticket {createdTicketNumber}
            </a>
          )}
        </p>
      )}

      <Button type="submit" data-tour="ticket-submit" disabled={submitting}>
        {submitting ? "Submitting..." : "Submit ticket"}
      </Button>
    </form>
  );
}
