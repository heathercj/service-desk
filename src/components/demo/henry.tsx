/**
 * Henry. A lion, drawn rather than fetched -- an inline SVG keeps the tour
 * self-contained and lets him take his colours from the active theme instead
 * of shipping two PNGs.
 *
 * Deliberately simple: the narration is where the value is, and a mascot that
 * needs an asset pipeline is a mascot that rots.
 */
export function Henry({ speaking = false }: { speaking?: boolean }) {
  return (
    <svg
      viewBox="0 0 64 64"
      className="h-11 w-11 shrink-0"
      role="img"
      aria-label="Henry the Lion"
    >
      {/* Mane */}
      <g className="text-warning" fill="currentColor">
        {Array.from({ length: 11 }, (_, i) => {
          const angle = (i / 11) * Math.PI * 2;
          return (
            <circle
              key={i}
              cx={32 + Math.cos(angle) * 20}
              cy={32 + Math.sin(angle) * 20}
              r={8.5}
              opacity={0.9}
            />
          );
        })}
      </g>
      {/* Face */}
      <circle cx="32" cy="32" r="17" className="text-warning" fill="currentColor" />
      <circle cx="32" cy="33" r="13.5" fill="#f6d9ab" />
      {/* Eyes -- closed to a contented line while he is talking */}
      {speaking ? (
        <>
          <path d="M23 30h5" stroke="#3b2a17" strokeWidth="1.8" strokeLinecap="round" />
          <path d="M36 30h5" stroke="#3b2a17" strokeWidth="1.8" strokeLinecap="round" />
        </>
      ) : (
        <>
          <circle cx="25.5" cy="30" r="2.1" fill="#3b2a17" />
          <circle cx="38.5" cy="30" r="2.1" fill="#3b2a17" />
        </>
      )}
      {/* Muzzle */}
      <path d="M32 34.5l-3.2 3h6.4z" fill="#3b2a17" />
      <path
        d="M32 37.5c0 2.5-2.6 2.5-2.6 0M32 37.5c0 2.5 2.6 2.5 2.6 0"
        stroke="#3b2a17"
        strokeWidth="1.5"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
}
