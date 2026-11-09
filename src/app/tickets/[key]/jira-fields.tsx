"use client";

import { useEffect, useRef, useState } from "react";
import { BoxHeader } from "@/components/ui/box-header";
import { button } from "@/components/ui/button";
import { Check, CopySheets } from "@/components/ui/icons";

/**
 * The For Jira box on a ticket's page. The fields arrive filled (jiraFields in page.tsx, on the server); this part only
 * copies them to the clipboard. Nothing is sent to Jira or saved.
 */

export type JiraField = { label: string; value: string; long?: boolean };

/** "Copy all", as opposed to one field's label. */
const ALL = "All fields";
/** How long "Copied" (or "Blocked") stays before the field's name comes back. */
const SHOWN_MS = 2000;

/** The older way to copy, for a browser that blocks the clipboard API (an embedded page, a managed browser). */
function copyByCommand(text: string): boolean {
  const before = document.activeElement as HTMLElement | null;
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.cssText = "position:fixed;top:0;left:0;opacity:0;pointer-events:none";
  document.body.appendChild(area);
  area.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  area.remove();
  before?.focus();
  return ok;
}

/**
 * The ticket in Jira's own fields, so the handover is a paste and not a rewrite. A click or tap anywhere on a field copies
 * it (unless the person selected part of it, to copy that by hand); its name is a button, for the keyboard. "Copy all"
 * copies every field. The answer shows in place of the field's name, one at a time and at the same size, so nothing
 * moves. Nothing is sent anywhere.
 */
export function JiraFields({ fields, className }: { fields: JiraField[]; className: string }) {
  const all = fields.map((f) => (f.long ? `${f.label}:\n${f.value}` : `${f.label}: ${f.value}`)).join("\n\n");
  // `n` counts copies: each one draws its tick again and tints its row again (two names for one tint, globals.css).
  const [shown, setShown] = useState<{ what: string; ok: boolean; n: number } | null>(null);
  // A new key for each message, so a screen reader announces the same words again on a second copy.
  const [said, setSaid] = useState({ n: 0, text: "" });
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy(what: string, text: string, value?: Element | null) {
    let ok = true;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      ok = copyByCommand(text);
      // Both blocked: select what is on screen, so Ctrl+C or ⌘C still works.
      if (!ok && value) {
        const range = document.createRange();
        range.selectNodeContents(value);
        window.getSelection()?.removeAllRanges();
        window.getSelection()?.addRange(range);
      }
    }
    // After the copy, so a second click while the first is still copying keeps its own 2 s.
    clearTimeout(timer.current);
    setShown((s) => ({ what, ok, n: (s?.n ?? 0) + 1 }));
    setSaid((s) => ({
      n: s.n + 1,
      text: ok ? `${what} copied.` : `Your browser blocked copying.${value ? " The text is selected: press Ctrl+C, or ⌘C on a Mac." : ""}`,
    }));
    timer.current = setTimeout(() => setShown(null), SHOWN_MS);
  }

  const answer = (ok: boolean, n: number) =>
    ok ? (
      // Inline-flex, so the row's hover underline does not run under "Copied".
      <span key={n} className="inline-flex items-center gap-1 text-slate-800">
        <Check className="h-3.5 w-3.5 text-slate-500" draw />
        Copied
      </span>
    ) : (
      <span className="inline-flex text-red-700">Blocked</span>
    );
  // The row (or, after "Copy all", every row) tints for a moment: what went to the clipboard.
  const tint = (label: string) =>
    shown?.ok && (shown.what === label || shown.what === ALL) ? (shown.n % 2 ? "tint-a" : "tint-b") : "";

  return (
    <section aria-labelledby="jira" data-tour="jira" className={className}>
      <BoxHeader
        icon={<CopySheets />}
        title="For Jira"
        titleId="jira"
        end={
          <button onClick={() => copy(ALL, all)} aria-label="Copy all fields" title="Copy all fields" className={`${button("secondary", "sm")} min-w-[4.5rem]`}>
            {shown?.what === ALL ? (shown.ok ? "Copied" : "Blocked") : "Copy all"}
          </button>
        }
      />
      <div className="p-4">
        <p className="text-meta text-slate-500">
          <span className="pointer-coarse:hidden">Click</span>
          <span className="hidden pointer-coarse:inline">Tap</span> a field to copy it. Nothing is sent.
        </p>
        <dl className="mt-2.5 flex flex-col gap-2">
          {fields.map((f) => (
            // The whole row copies on a click (the mouse's and the finger's way in); the keyboard and screen readers use
            // the name's button. The negative margin gives the hover tint room without moving anything.
            <div
              key={f.label}
              onClick={(e) => {
                if (window.getSelection()?.toString()) return;
                copy(f.label, f.value, e.currentTarget.querySelector("dd"));
              }}
              className={`group -mx-2 -my-1 grid cursor-pointer grid-cols-[5.5rem_minmax(0,1fr)] gap-x-3 rounded-md px-2 py-1 hover:bg-slate-50 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent ${tint(f.label)}`}
            >
              <dt>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    copy(f.label, f.value, e.currentTarget.closest("div")?.querySelector("dd"));
                  }}
                  aria-label={`Copy ${f.label.toLowerCase()}`}
                  title={`Copy ${f.label.toLowerCase()}`}
                  className="text-left text-slate-500 underline-offset-2 outline-none group-hover:text-accent group-hover:underline"
                >
                  {shown?.what === f.label ? answer(shown.ok, shown.n) : f.label}
                </button>
              </dt>
              <dd className="min-w-0 text-slate-800">
                {f.long ? (
                  // A three-line preview without the blank lines; the fading last line shows the text goes on.
                  <span className="block max-h-15 overflow-hidden text-meta whitespace-pre-line text-slate-700 [mask-image:linear-gradient(to_bottom,black_70%,transparent)]">
                    {f.value.replace(/\n{2,}/g, "\n")}
                  </span>
                ) : (
                  f.value
                )}
              </dd>
            </div>
          ))}
        </dl>
        <p role="status" className="sr-only">
          <span key={said.n}>{said.text}</span>
        </p>
      </div>
    </section>
  );
}
