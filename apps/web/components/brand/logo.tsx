/**
 * The RentFlow mark: "Confirmed Home" — a house with a tick (every rupee confirmed).
 * Inline SVG so it can animate ("Draw & confirm"): the outline draws itself, the
 * tick snaps in with a small pop. `intro` plays once on page load; `hover` replays
 * when the pointer is over an element with the `rf-logo-trigger` class.
 * Animations live in app/globals.css and are off for reduced-motion users.
 */
export function Logo({
  size = 32,
  motion = "intro hover",
  className = "",
  label,
}: {
  size?: number;
  motion?: "intro hover" | "intro" | "hover" | "none";
  className?: string;
  /** Accessible name when the logo stands alone (e.g. without the word "RentFlow" next to it). */
  label?: string;
}) {
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={`rf-logo shrink-0 ${className}`}
      data-motion={motion}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <rect width="64" height="64" rx="16" fill="#0F766E" />
      <path className="rf-logo-house" pathLength={100} d="M13 31 32 15l19 16v16a4 4 0 0 1-4 4H17a4 4 0 0 1-4-4Z" fill="none" stroke="#fff" strokeWidth={4.5} strokeLinejoin="round" strokeLinecap="round" />
      <path className="rf-logo-tick" pathLength={100} d="m23.5 36.5 6 6 11-12" fill="none" stroke="#5EEAD4" strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Logo + the word "RentFlow". */
export function Wordmark({ size = 32, motion = "intro hover", className = "" }: { size?: number; motion?: "intro hover" | "intro" | "hover" | "none"; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <Logo size={size} motion={motion} />
      <span className="text-lg font-semibold tracking-tight text-ink">
        Rent<span className="text-primary">Flow</span>
      </span>
    </span>
  );
}
