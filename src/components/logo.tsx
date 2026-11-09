/** A tangled line that runs straight at the end. In the header it is drawn again as the pointer arrives (globals.css). */
export function Logo({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={className}>
      <rect width="32" height="32" rx="7" className="fill-accent-dark" />
      <path
        className="logo-line"
        pathLength={1}
        d="M6 12c3-6 6 6 9 0s4 8 6 8h5"
        fill="none"
        stroke="white"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
