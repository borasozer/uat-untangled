/** Class names for buttons and button-like links, so a <Link> and a <button> look the same. */
const BASE =
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-md font-medium whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-50";

/** `primary`: the one main action; `secondary`: the others; `quiet`: text only, a lesser choice ("Back"). */
const VARIANT = {
  // Main action: outlined rather than filled, so it is easy to find without pulling the eye from the rest of the page.
  primary: "bg-white text-accent-fill inset-ring-[1.5px] inset-ring-accent hover:bg-accent-soft",
  secondary: "border border-slate-300 bg-white text-slate-800 hover:bg-slate-50",
  quiet: "text-accent hover:bg-accent-soft",
} as const;

/** Heights: `sm` 32 px; `md` 36 px, and 40 px below 640 px wide, where a finger presses it. */
const SIZE = {
  sm: "h-8 px-2.5 text-meta",
  md: "h-9 px-3.5 text-sm max-sm:h-10",
} as const;

export function button(variant: keyof typeof VARIANT = "secondary", size: keyof typeof SIZE = "md"): string {
  return `${BASE} ${VARIANT[variant]} ${SIZE[size]}`;
}
