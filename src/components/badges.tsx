import { ticketStatusLabel } from "@/lib/labels";
import type { TicketStatus } from "@/lib/types";

/**
 * Labels are neutral grey. Colour keeps two meanings only: amber when something needs a person's attention, red when
 * something failed. Blue is reserved for what can be clicked or is selected.
 */
const TONES = {
  neutral: "bg-slate-100 text-slate-700",
  attention: "bg-amber-50 text-amber-900",
  failure: "bg-red-50 text-red-800",
} as const;

export type Tone = keyof typeof TONES;

/** A small label, grey by default; "attention" (amber) and "failure" (red) only for the two meanings above. */
export function Pill({ tone = "neutral", children, title }: { tone?: Tone; children: React.ReactNode; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs whitespace-nowrap ${TONES[tone]}`}>
      {children}
    </span>
  );
}

/**
 * How sure the AI is, as a number. Below 85% it is set in amber, and a screen reader also hears "check closely", so a
 * doubtful suggestion stands out.
 */
export function Confidence({ value, suffix = "" }: { value: number; suffix?: string }) {
  const pct = Math.round(value * 100);
  const doubtful = pct < 85;
  return (
    <span className={`tabular-nums whitespace-nowrap ${doubtful ? "font-medium text-amber-800" : "text-slate-700"}`}>
      {pct}%{suffix}
      {doubtful && <span className="sr-only"> (lower confidence: check closely)</span>}
    </span>
  );
}

/** The same figure as a short bar, amber below 85%, for reading at a glance. */
export function ConfidenceBar({ value }: { value: number }) {
  // Amber from the rounded figure, as the number beside it is: 84.6% reads 85%, so the bar stays blue too.
  const doubtful = Math.round(value * 100) < 85;
  return (
    <span aria-hidden className="inline-block h-1.5 w-16 overflow-hidden rounded-full bg-slate-200 align-middle">
      <span
        className={`block h-full rounded-full ${doubtful ? "bg-amber-500" : "bg-accent-fill"}`}
        style={{ width: `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%` }}
      />
    </span>
  );
}

/** Agreement between the separate AI runs as dots: ●●○ 2 of 3 agree. */
export function Agreement({ agreeing, samples }: { agreeing: number; samples: number }) {
  if (samples <= 1) return null;
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-slate-600">
      <span aria-hidden className="flex gap-0.5">
        {Array.from({ length: samples }, (_, i) => (
          <span key={i} className={`h-2 w-2 rounded-full ${i < agreeing ? "bg-accent-fill" : "border border-slate-400"}`} />
        ))}
      </span>
      {agreeing} of {samples} agree
    </span>
  );
}

/** A ticket's status, worded the same on every page. */
export function TicketStatusBadge({ status, kind = "bug" }: { status: TicketStatus; kind?: "bug" | "idea" }) {
  return <Pill>{ticketStatusLabel(status, kind)}</Pill>;
}
