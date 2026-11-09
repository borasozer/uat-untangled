import type { ReactNode } from "react";

/**
 * A button's words and what it says while it works, in one cell: the button keeps the width of the longer one, so it
 * never changes size under the pointer. The hidden one is out of the accessible name too.
 */
export function BusyLabel({ busy, children, busyText }: { busy: boolean; children: ReactNode; busyText: string }) {
  return (
    <span className="grid justify-items-center">
      <span className={`inline-flex items-center gap-2 [grid-area:1/1] ${busy ? "invisible" : ""}`}>{children}</span>
      <span className={`[grid-area:1/1] ${busy ? "" : "invisible"}`}>{busyText}</span>
    </span>
  );
}

/** The same for a label that changes weight with its state: the bold copy, hidden, keeps the room it needs. */
export function SteadyLabel({ children, weight }: { children: string; weight: "font-medium" | "font-semibold" }) {
  return (
    <span className="inline-grid">
      <span className="[grid-area:1/1]">{children}</span>
      <span aria-hidden className={`invisible [grid-area:1/1] ${weight}`}>
        {children}
      </span>
    </span>
  );
}
