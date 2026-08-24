import { useId } from "react";

/**
 * Henry. Inline SVG rather than a fetched asset, so the tour stays
 * self-contained: no image request to fail on a demo machine with flaky
 * wifi, no second file to keep in step with the component that draws it.
 *
 * The artwork is fixed-palette on purpose. He is a mascot with a brand on his
 * cap, and a mascot whose colours drift with the theme stops being the same
 * character -- so unlike the rest of the app he does not take his fill from
 * the token set. The panel around him does.
 *
 * The two clip paths are referenced by `url(#id)`, which is document-global:
 * two Henrys on one page would both resolve to whichever mounted first. The
 * ids are therefore per-instance via useId, so the launcher and the panel can
 * coexist without one silently clipping against the other's geometry.
 */
export function Henry({ className = "h-11 w-11" }: { className?: string }) {
  const uid = useId();
  const maneClip = `henry-mane-${uid}`;
  const faceClip = `henry-face-${uid}`;

  const manePath =
    "M50.00,21.00 Q54.67,34.53 52.34,27.76 Q64.75,24.37 59.71,29.45 Q63.09,38.58 " +
    "63.92,31.47 Q76.58,33.80 69.84,36.19 Q68.92,45.89 72.75,39.84 Q83.15,47.43 " +
    "76.03,46.66 Q71.00,55.00 77.07,51.22 Q83.15,62.57 77.07,58.78 Q68.92,64.11 " +
    "76.03,63.34 Q76.58,76.20 72.75,70.16 Q63.09,71.42 69.84,73.81 Q64.75,85.63 " +
    "63.92,78.53 Q54.67,75.47 59.71,80.55 Q50.00,89.00 52.34,82.24 Q45.33,75.47 " +
    "47.66,82.24 Q35.25,85.63 40.29,80.55 Q36.91,71.42 36.08,78.53 Q23.42,76.20 " +
    "30.16,73.81 Q31.08,64.11 27.25,70.16 Q16.85,62.57 23.97,63.34 Q29.00,55.00 " +
    "22.93,58.78 Q16.85,47.43 22.93,51.22 Q31.08,45.89 23.97,46.66 Q23.42,33.80 " +
    "27.25,39.84 Q36.91,38.58 30.16,36.19 Q35.25,24.37 36.08,31.47 Q45.33,34.53 " +
    "40.29,29.45 Q50.00,21.00 47.66,27.76 Z";

  const facePath =
    "M50,33 C61,33 69,40 71,49 C73,57 71,65 65,71 C60,76 54,79 50,79 C46,79 " +
    "40,76 35,71 C29,65 27,57 29,49 C31,40 39,33 50,33 Z";

  return (
    <svg
      viewBox="0 0 100 100"
      className={`${className} shrink-0`}
      role="img"
      aria-label="Henry the Lion"
    >
      <defs>
        <clipPath id={maneClip}>
          <path d={manePath} />
        </clipPath>
        <clipPath id={faceClip}>
          <path d={facePath} />
        </clipPath>
      </defs>

      {/* Mane: flat fill, a clipped circle for the shaded side, then the outline
          back on top so the shading cannot bleed over the edge. */}
      <path d={manePath} fill="#E8791A" />
      <g clipPath={`url(#${maneClip})`}>
        <circle cx="65" cy="72" r="40" fill="#C4600E" />
      </g>
      <path
        d={manePath}
        fill="none"
        stroke="#3A1E0B"
        strokeWidth="2.6"
        strokeLinejoin="round"
      />

      {/* Ears */}
      <path
        d="M40,38 L25,24 L30,44 Z"
        fill="#F5A83C"
        stroke="#3A1E0B"
        strokeWidth="2.4"
        strokeLinejoin="round"
      />
      <path
        d="M60,38 L75,24 L70,44 Z"
        fill="#F5A83C"
        stroke="#3A1E0B"
        strokeWidth="2.4"
        strokeLinejoin="round"
      />
      <path d="M38,38.5 L28,29 L32,42 Z" fill="#F5B9C0" />
      <path d="M62,38.5 L72,29 L68,42 Z" fill="#F5B9C0" />

      {/* Face */}
      <path
        d={facePath}
        fill="#FBCE84"
        stroke="#3A1E0B"
        strokeWidth="2.6"
        strokeLinejoin="round"
      />
      <g clipPath={`url(#${faceClip})`}>
        <circle cx="63" cy="73" r="22" fill="#F2B968" />
      </g>
      <path
        d={facePath}
        fill="none"
        stroke="#3A1E0B"
        strokeWidth="2.6"
        strokeLinejoin="round"
      />

      {/* Cheek ruffs, darker than the mane so they read as fur rather than
          as the mane showing through. */}
      <g fill="#C4600E" stroke="#3A1E0B" strokeWidth="1.6" strokeLinejoin="round">
        <path d="M27,52 Q18,53 19,60 Q26,59 29,54 Z" />
        <path d="M27,63 Q17,65 19,72 Q27,70 30,65 Z" />
        <path d="M73,52 Q82,53 81,60 Q74,59 71,54 Z" />
        <path d="M73,63 Q83,65 81,72 Q73,70 70,65 Z" />
      </g>

      <ellipse
        cx="50"
        cy="67"
        rx="16"
        ry="10.5"
        fill="#FFF3DC"
        stroke="#3A1E0B"
        strokeWidth="2"
      />

      {/* Brows */}
      <path
        d="M34,47 Q41,43 47,46.5"
        fill="none"
        stroke="#3A1E0B"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
      <path
        d="M53,46.5 Q59,43 66,47"
        fill="none"
        stroke="#3A1E0B"
        strokeWidth="2.6"
        strokeLinecap="round"
      />

      {/* Eyes */}
      <path
        d="M34,51.5 Q40.5,46.5 47,50 Q41,55.5 34,51.5 Z"
        fill="#FFFFFF"
        stroke="#3A1E0B"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M66,51.5 Q59.5,46.5 53,50 Q59,55.5 66,51.5 Z"
        fill="#FFFFFF"
        stroke="#3A1E0B"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <circle cx="41" cy="51.6" r="3.4" fill="#3A1E0B" />
      <circle cx="59" cy="51.6" r="3.4" fill="#3A1E0B" />
      <circle cx="42.5" cy="49.9" r="1.2" fill="#FFFFFF" />
      <circle cx="60.5" cy="49.9" r="1.2" fill="#FFFFFF" />

      {/* Nose and mouth */}
      <path
        d="M43,60.5 L57,60.5 L50,67 Z"
        fill="#C96A3E"
        stroke="#3A1E0B"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M50,67 V69"
        fill="none"
        stroke="#3A1E0B"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M50,69 Q43,73 37,69.5"
        fill="none"
        stroke="#3A1E0B"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M50,69 Q57,73 63,69.5"
        fill="none"
        stroke="#3A1E0B"
        strokeWidth="1.8"
        strokeLinecap="round"
      />

      <g stroke="#8A5A2B" strokeWidth="1" strokeLinecap="round" fill="none">
        <path d="M41,62 Q30,60.5 20,60" />
        <path d="M42,64.5 Q31,64.5 21,64.5" />
        <path d="M43,67 Q34,68.5 25,69.5" />
        <path d="M59,62 Q70,60.5 80,60" />
        <path d="M58,64.5 Q69,64.5 79,64.5" />
        <path d="M57,67 Q66,68.5 75,69.5" />
      </g>

      {/* Cap */}
      <path
        d="M42,34 C26,33 12,36 6,42 C9,45 16,46 23,45 C33,43 39,39 43,35 Z"
        fill="#141414"
        stroke="#3A1E0B"
        strokeWidth="2.4"
        strokeLinejoin="round"
      />
      <path
        d="M27,33 C27,8 73,8 73,33 Z"
        fill="#1B1B1B"
        stroke="#3A1E0B"
        strokeWidth="2.6"
        strokeLinejoin="round"
      />
      <path
        d="M50,13 C40,16 33,23 31,32"
        fill="none"
        stroke="#3A3A3A"
        strokeWidth="1.1"
        strokeLinecap="round"
      />
      <path
        d="M50,13 C60,16 67,23 69,32"
        fill="none"
        stroke="#3A3A3A"
        strokeWidth="1.1"
        strokeLinecap="round"
      />
      <circle cx="50" cy="12.5" r="2" fill="#1B1B1B" stroke="#3A1E0B" strokeWidth="1.1" />

      {/* The A, drawn as a dark stroke with the gold laid over it so the
          letter keeps a readable edge against the cap at small sizes. */}
      <g strokeLinecap="round" strokeLinejoin="round" fill="none">
        <path
          d="M50,17.5 L44.5,31 M50,17.5 L55.5,31 M46.5,25.5 L53.5,25.5"
          stroke="#3A1E0B"
          strokeWidth="5.6"
        />
        <path
          d="M50,17.5 L44.5,31 M50,17.5 L55.5,31 M46.5,25.5 L53.5,25.5"
          stroke="#F5C518"
          strokeWidth="3"
        />
      </g>
    </svg>
  );
}

/**
 * What Henry is saying, as a bubble with a tail pointing back at him.
 *
 * The tail is a rotated square sharing the bubble's background and two of its
 * borders, so it stays joined to the bubble in both themes without a second
 * SVG to keep in sync. `aria-hidden` because it is punctuation, not content --
 * the panel is already an aria-live region and the tail must not be announced.
 */
export function HenrySays({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`relative min-w-0 flex-1 rounded-xl border border-border bg-muted/50 px-3 py-2.5 ${className}`}
    >
      <span
        aria-hidden
        className="absolute -left-[7px] top-6 h-3 w-3 rotate-45 border-b border-l border-border bg-muted/50"
      />
      {children}
    </div>
  );
}
