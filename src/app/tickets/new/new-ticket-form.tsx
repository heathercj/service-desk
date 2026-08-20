"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { z } from "zod";
import {
  createTicketObjectSchema,
  createTicketSchema,
  DEPARTMENT_KEYS,
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
      departmentKey: "TECHNOLOGY_SUPPORT",
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
      <Card className="mt-6">
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
          <Label>Name</Label>
          <Input value={submitterName} disabled aria-readonly />
        </div>
        <div>
          <Label>Email</Label>
          <Input value={submitterEmail} disabled aria-readonly />
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
          {...register("subject")}
          aria-invalid={Boolean(errors.subject)}
        />
        {errors.subject && (
          <p className="mt-1 text-sm text-destructive">{errors.subject.message}</p>
        )}
      </div>

      <div>
        <Label htmlFor="description">Describe the issue</Label>
        <Textarea
          id="description"
          rows={6}
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

      {suggestions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">This might already be answered</CardTitle>
            <CardDescription>Based on your subject and description.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {suggestions.map((s) => (
              <div key={s.articleId} className="rounded-md border border-border p-3">
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

      <div>
        <Label htmlFor="departmentKey">Department</Label>
        <Select id="departmentKey" {...register("departmentKey")}>
          {DEPARTMENT_KEYS.map((key) => (
            <option key={key} value={key}>
              {key.replaceAll("_", " ")}
            </option>
          ))}
        </Select>
      </div>

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
          <input type="checkbox" className="mt-1" {...register("consentAcknowledged")} />
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
          {submitError}
        </p>
      )}

      <Button type="submit" disabled={submitting}>
        {submitting ? "Submitting..." : "Submit ticket"}
      </Button>
    </form>
  );
}
