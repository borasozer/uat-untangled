import { SEVERITY_LABEL } from "@/lib/labels";
import type { Severity as SeverityLevel } from "@/lib/types";

/** A ticket's severity, as the developer's ticket list, a ticket's page and a new ticket in Review show it. */

const LEVEL: Record<SeverityLevel, { bars: number; color: string }> = {
  critical: { bars: 4, color: "bg-red-700" },
  high: { bars: 3, color: "bg-red-600" },
  medium: { bars: 2, color: "bg-amber-500" },
  low: { bars: 1, color: "bg-slate-500" },
};

/** Severity as rising bars plus the word, so each level looks different and colour is never the only signal. */
export function Severity({ value, className = "" }: { value: SeverityLevel | null; className?: string }) {
  if (!value) {
    return (
      <span className={`text-slate-500 ${className}`}>
        <span aria-hidden>–</span>
        <span className="sr-only">No severity</span>
      </span>
    );
  }
  const { bars, color } = LEVEL[value];
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap ${className}`}>
      <span aria-hidden className="flex items-end gap-0.5">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={`w-1 rounded-sm ${i < bars ? color : "bg-slate-200"}`} style={{ height: 6 + i * 2 }} />
        ))}
      </span>
      <span className="text-sm text-slate-800">{SEVERITY_LABEL[value]}</span>
    </span>
  );
}
