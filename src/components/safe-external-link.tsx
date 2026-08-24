/**
 * Renders a user-submitted URL (Section 15: SSRF and unsafe links). Never
 * fetched or previewed server-side -- shown only as an inert, clearly
 * labelled external link with its hostname surfaced so the reader knows
 * exactly where it points before clicking.
 */
export function SafeExternalLink({ url, hostname }: { url: string; hostname: string }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer nofollow"
        className="text-primary underline"
      >
        {url}
      </a>
      <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-foreground">
        User-submitted · {hostname}
      </span>
    </div>
  );
}
