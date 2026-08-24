/**
 * The product wordmark: whose desk this is, what it is, and the platform it
 * belongs to.
 *
 * One component rather than three copies, because it appears in both nav
 * states and on the login page -- and branding that disagrees with itself
 * between pages is worse than none.
 *
 * No mascot here on purpose. Henry is the guide, not the logo: putting the
 * lion in the chrome as well would turn the tour's own character into
 * decoration, and he stops being the thing that talks to you.
 */

/**
 * Stacked lockup -- owner above product. `Alair Homes` is deliberately the
 * quiet half: everyone reading it already knows where they work, and what
 * they are looking for on the page is "Service Desk".
 */
export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`flex flex-col leading-none ${className}`}>
      <span className="text-[0.7rem] font-medium uppercase tracking-[0.16em] text-muted-foreground">
        Alair Homes
      </span>
      <span className="mt-0.5 text-lg font-semibold">Service Desk</span>
    </span>
  );
}

/**
 * The platform badge.
 *
 * Text rather than an image so it inherits the token colours and stays legible
 * in both themes -- the APEX colour tokens this app is built on are the reason
 * it can claim the badge in the first place (see globals.css).
 *
 * The `sr-only` tail is why this is not just a styled span: "APEX" alone tells
 * a screen-reader user nothing, and an aria-label on a span with no role is
 * unreliably announced.
 */
export function ApexBadge({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full border border-border px-2 py-0.5 text-[0.7rem] font-semibold uppercase tracking-widest text-muted-foreground ${className}`}
    >
      APEX
      <span className="sr-only"> platform</span>
    </span>
  );
}
