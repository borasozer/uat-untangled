"use client";

import { Popover, PopoverButton, PopoverPanel } from "@headlessui/react";
import { TIP_BOX } from "./tip";

/**
 * A small (i) that shows a note in the app's own floating box, so the note never pushes anything down. `inline`: inside
 * a line of text.
 */
export function InfoTip({ label, text, inline = false }: { label: string; text: string; inline?: boolean }) {
  return (
    <Popover as={inline ? "span" : "div"} className={inline ? "ml-1 inline-flex align-[-3px]" : "flex"}>
      <PopoverButton
        aria-label={label}
        className="flex h-[1.125rem] w-[1.125rem] shrink-0 items-center justify-center rounded-full border border-slate-300 bg-white text-[11px] leading-none font-semibold text-slate-600 hover:border-slate-400 hover:text-slate-900 data-open:border-accent data-open:text-accent"
      >
        i
      </PopoverButton>
      <PopoverPanel
        anchor={{ to: "top start", gap: 6, padding: 8 }}
        className={`z-50 w-[min(22.5rem,calc(100vw-1rem))] focus:outline-none ${TIP_BOX}`}
      >
        {text}
      </PopoverPanel>
    </Popover>
  );
}
