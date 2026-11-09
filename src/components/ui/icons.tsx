/** Small line icons, drawn inline so they inherit the text colour. */
type IconProps = { className?: string };

/** A chevron: a menu or a section that opens (a caller turns it over while open). */
export function ChevronDown({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg aria-hidden viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" className={className}>
      <path d="m4 6 4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** `draw`: the tick is drawn as it appears, for a moment of "done" (sent, approved, copied). */
export function Check({ className = "h-4 w-4", draw = false }: IconProps & { draw?: boolean }) {
  return (
    <svg aria-hidden viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <path
        d="m3.5 8.5 3 3 6-7"
        strokeLinecap="round"
        strokeLinejoin="round"
        {...(draw && { pathLength: 1, className: "tick-draw" })}
      />
    </svg>
  );
}

/** A cross: a close or remove button, and "failed" or "still broken" where a tick says it works. */
export function Cross({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg aria-hidden viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <path d="m4.5 4.5 7 7m0-7-7 7" strokeLinecap="round" />
    </svg>
  );
}

/** A route from a start to an end: the guided tour. Its line is drawn again as the pointer arrives (`ri-route`, globals.css). */
export function Route({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <circle cx="5" cy="18" r="2" />
      <path className="ri-route" pathLength={1} d="M7 18h5a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h8" />
      <circle cx="19" cy="6" r="2" />
    </svg>
  );
}

/* Box title icons, 24×24 in the role icons' line style. */

/** A list: a box of reports. */
export function Lines({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className={className}>
      <path d="M4 6.5h16M4 12h16M4 17.5h10" strokeLinecap="round" />
    </svg>
  );
}

/** A speech bubble: what someone wrote. */
export function Speech({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className={className}>
      <path
        d="M5 4.5h14a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5H10l-4.5 3.5V16.5H5A1.5 1.5 0 0 1 3.5 15V6A1.5 1.5 0 0 1 5 4.5z"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** A tick in a circle: a decision. */
export function CheckCircle({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className={className}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m8.5 12.2 2.4 2.4 4.8-5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** A numbered list: steps to follow. */
export function NumberedList({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className={className}>
      <path d="M10.5 6.5H20M10.5 12H20M10.5 17.5H20" strokeLinecap="round" />
      <path d="M4.5 5.2 6 4.5v4M4.3 13.6a1.3 1.3 0 0 1 2.4.7c0 1-2.4 1.6-2.4 2.9h2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Two sheets: something to copy. */
export function CopySheets({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className={className}>
      <rect x="8.5" y="8.5" width="11" height="11" rx="1.8" />
      <path d="M15.5 8.5V6.3a1.8 1.8 0 0 0-1.8-1.8H6.3a1.8 1.8 0 0 0-1.8 1.8v7.4a1.8 1.8 0 0 0 1.8 1.8h2.2" />
    </svg>
  );
}

/** A clock: what happened when. */
export function Clock({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className={className}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** A bug: a defect to fix. */
export function Bug({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className={className}>
      <rect x="7.5" y="8" width="9" height="12" rx="4.5" />
      <path
        d="M9.5 8a2.5 2.5 0 0 1 5 0M12 12v8M4 13h3.5M16.5 13H20M5 8.5l2.7 1.6M19 8.5l-2.7 1.6M5 18.5l2.7-1.6M19 18.5l-2.7-1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** A light bulb: an idea. */
export function Bulb({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className={className}>
      <path d="M9.5 17.5h5M10.5 20.5h3" strokeLinecap="round" />
      <path
        d="M12 3.5a5.8 5.8 0 0 0-3.4 10.5c.6.5.9 1.1.9 1.9v1.6h5v-1.6c0-.8.3-1.4.9-1.9A5.8 5.8 0 0 0 12 3.5z"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** GitHub's mark: the link to the code. Filled, as GitHub draws it. */
export function GitHubMark({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M12 .5C5.73.5.5 5.74.5 12.02c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56l-.02-1.96c-3.2.7-3.87-1.54-3.87-1.54-.52-1.33-1.28-1.69-1.28-1.69-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.19 1.76 1.19 1.03 1.76 2.69 1.25 3.35.96.1-.75.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.8 1.19 1.83 1.19 3.09 0 4.42-2.69 5.39-5.26 5.68.41.36.78 1.06.78 2.14l-.01 3.18c0 .31.21.68.8.56A11.53 11.53 0 0 0 23.5 12.02C23.5 5.74 18.27.5 12 .5Z" />
    </svg>
  );
}
