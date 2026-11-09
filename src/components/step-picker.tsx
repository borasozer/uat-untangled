"use client";

import { Button, Popover, PopoverButton, PopoverPanel } from "@headlessui/react";
import { useEffect, useRef, useState, type Ref } from "react";
import type { Script, Step } from "@/lib/types";
import { ChevronDown, Cross } from "./ui/icons";

/**
 * Picks the test step a report is about, or none. The list floats over the page, so nothing below it moves: test
 * scripts on the left, their steps with what should happen on the right (one after the other on a phone). On opening,
 * focus goes to the chosen step (or else the first step shown), and a focus ring shows only when the keyboard is used.
 */
export function StepPicker({
  scripts,
  value,
  onChange,
  startScript,
  buttonRef,
  disabled = false,
}: {
  scripts: (Script & { steps: Step[] })[];
  value: string | null;
  onChange: (stepId: string | null) => void;
  /** The script to show first when no step is chosen: the one the tester last reported on. */
  startScript: string;
  /** So another control (the AI's "Other step") can open the list. */
  buttonRef?: Ref<HTMLButtonElement>;
  disabled?: boolean;
}) {
  const step = scripts.flatMap((s) => s.steps).find((s) => s.id === value) ?? null;
  return (
    <div className="flex min-w-0 shrink items-center gap-1">
      <Popover className="min-w-0">
        <PopoverButton
          ref={buttonRef}
          disabled={disabled}
          aria-label={step ? `Test step: ${step.id}, ${step.instruction}` : "Test step (optional): not on a step"}
          className="flex h-8 max-w-full min-w-0 items-center gap-2 rounded-md border border-slate-300 bg-white px-2.5 text-sm text-slate-900 hover:border-slate-400 disabled:opacity-60 data-open:border-accent max-sm:h-9"
        >
          {step ? (
            <>
              <span className="shrink-0 font-mono text-meta text-slate-500">{step.id}</span>
              <span className="truncate">{step.instruction}</span>
            </>
          ) : (
            <span className="truncate text-slate-700">Not on a step</span>
          )}
          <ChevronDown className="h-4 w-4 shrink-0 text-slate-500" />
        </PopoverButton>
        <PopoverPanel
          anchor={{ to: "bottom start", gap: 4, padding: 8 }}
          focus
          className="z-50 w-[min(46rem,calc(100vw-1rem))] overflow-hidden rounded-lg border border-box-line bg-white text-sm shadow-lg focus:outline-none"
        >
          {({ close }) => (
            <Lists
              scripts={scripts}
              start={step?.script_id ?? startScript}
              value={value}
              onPick={(id) => {
                onChange(id);
                close();
              }}
            />
          )}
        </PopoverPanel>
      </Popover>
      {step && !disabled && (
        <button
          type="button"
          onClick={() => onChange(null)}
          aria-label="Remove the step"
          title="Remove the step"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-800 max-sm:h-9 max-sm:w-9"
        >
          <Cross className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

/** A ring for keyboard focus only (Headless UI's data-focus); a click, or opening the list with the mouse, shows none. */
const RING = "outline-none data-focus:outline-2 data-focus:-outline-offset-2 data-focus:outline-solid data-focus:outline-accent";

/** The scripts and steps inside the open picker, starting on the `start` script (or the first). A pick closes it. */
function Lists({
  scripts,
  start,
  value,
  onPick,
}: {
  scripts: (Script & { steps: Step[] })[];
  start: string;
  value: string | null;
  onPick: (stepId: string | null) => void;
}) {
  const [shown, setShown] = useState(scripts.some((s) => s.id === start) ? start : (scripts[0]?.id ?? ""));
  // On a phone the two lists take turns; on a wider screen they sit side by side.
  const [phoneView, setPhoneView] = useState<"scripts" | "steps">("steps");
  const script = scripts.find((s) => s.id === shown);
  // The keyboard starts on the chosen step, or the first step shown (also on a phone, where the scripts are hidden at
  // first); Headless UI would otherwise focus the first script, which looks chosen when it is not.
  const chosen = useRef<HTMLButtonElement>(null);
  useEffect(() => chosen.current?.focus({ preventScroll: true }), []);
  return (
    <>
      <div className="grid sm:grid-cols-[17rem_minmax(0,1fr)]">
        <div className={`border-slate-200 bg-slate-50 p-1.5 sm:border-r ${phoneView === "steps" ? "max-sm:hidden" : ""}`}>
          <p className="px-2 pt-1 pb-1.5 text-xs font-medium text-slate-500">Test scripts</p>
          {scripts.map((s) => (
            <Button
              key={s.id}
              onClick={() => {
                setShown(s.id);
                setPhoneView("steps");
              }}
              aria-pressed={s.id === shown}
              className={`flex w-full items-baseline gap-2 rounded-md px-2 py-1.5 text-left text-slate-700 hover:bg-slate-100 aria-pressed:bg-white aria-pressed:text-slate-900 aria-pressed:shadow-[inset_0_0_0_1px_var(--color-slate-300)] ${RING}`}
            >
              <span className="shrink-0 font-mono text-xs text-slate-500">{s.id}</span>
              <span className="min-w-0">{s.title}</span>
            </Button>
          ))}
        </div>
        <div className={`max-h-[min(24rem,60vh)] overflow-y-auto p-1.5 ${phoneView === "scripts" ? "max-sm:hidden" : ""}`}>
          <button
            type="button"
            onClick={() => setPhoneView("scripts")}
            className="mb-1 px-2 py-1 text-meta text-accent hover:underline sm:hidden"
          >
            ← All test scripts
          </button>
          <p className="px-2 pt-1 pb-1.5 text-xs font-medium text-slate-500">
            {script ? `${script.id} · ${script.title}` : "Steps"}
          </p>
          {script?.steps.map((s, i) => (
            <Button
              key={s.id}
              ref={(value ? s.id === value : i === 0) ? chosen : undefined}
              onClick={() => onPick(s.id)}
              aria-current={s.id === value ? "true" : undefined}
              className={`block w-full rounded-md px-2 py-1.5 text-left hover:bg-accent-soft aria-[current]:bg-accent-soft ${RING}`}
            >
              <span className="text-slate-900">
                <span className="font-mono text-xs text-slate-500">{s.step_no}</span> {s.instruction}
              </span>
              <span className="mt-0.5 block text-xs text-slate-500">Should happen: {s.expected}</span>
            </Button>
          ))}
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-slate-200 px-3.5 py-2 text-meta">
        <span className="text-slate-500">Pick the step you were on.</span>
        <button type="button" onClick={() => onPick(null)} className="text-accent hover:underline">
          Not on a step
        </button>
      </div>
    </>
  );
}
