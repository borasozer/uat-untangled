"use client";

import { Field, Label, Listbox, ListboxButton, ListboxOption, ListboxOptions } from "@headlessui/react";
import { Check, ChevronDown } from "./icons";

/** The app's drop-down menu: the header's "You are" (which tester), and in Review the ticket a report is added to. */

export type SelectOption<T extends string> = { value: T; label: string; detail?: string; disabled?: boolean };

/**
 * A designed replacement for the browser's <select>: keyboard (arrows, Home/End, type to search, Enter, Esc) and
 * screen reader support come from Headless UI. Options can carry a second, smaller line.
 */
export function Select<T extends string>({
  label,
  hideLabel = false,
  value,
  onChange,
  options,
  placeholder = "Choose…",
  className = "",
  buttonClassName = "",
  disabled = false,
}: {
  label: string;
  hideLabel?: boolean;
  value: T | null;
  onChange: (value: T) => void;
  options: SelectOption<T>[];
  placeholder?: string;
  className?: string;
  buttonClassName?: string;
  disabled?: boolean;
}) {
  const current = options.find((o) => o.value === value);
  return (
    <Field className={`flex min-w-0 flex-col gap-1 ${className}`} disabled={disabled}>
      <Label className={hideLabel ? "sr-only" : "text-meta font-medium text-slate-700"}>{label}</Label>
      <Listbox value={value} onChange={(v: T | null) => v !== null && onChange(v)}>
        <ListboxButton
          className={`relative flex h-9 w-full min-w-0 items-center rounded-md border border-slate-300 bg-white pr-8 pl-3 text-left text-sm text-slate-900 hover:border-slate-400 data-disabled:opacity-60 data-open:border-accent max-sm:h-10 max-sm:text-base ${buttonClassName}`}
        >
          <span className="truncate">{current ? current.label : <span className="text-slate-500">{placeholder}</span>}</span>
          <ChevronDown className="pointer-events-none absolute right-2.5 h-4 w-4 text-slate-500" />
        </ListboxButton>
        <ListboxOptions
          anchor={{ to: "bottom start", gap: 4, padding: 8 }}
          modal={false}
          className="z-50 max-h-80 w-(--button-width) min-w-60 overflow-auto rounded-md border border-slate-200 bg-white p-1 text-sm shadow-lg focus:outline-none"
        >
          {options.map((o) => (
            <ListboxOption
              key={o.value}
              value={o.value}
              disabled={o.disabled}
              className="group flex cursor-default items-start gap-2 rounded px-2 py-1.5 select-none data-disabled:opacity-50 data-focus:bg-slate-100"
            >
              <Check className="invisible mt-0.5 h-4 w-4 shrink-0 text-accent group-data-selected:visible" />
              <span className="min-w-0">
                <span className="block text-slate-900 group-data-selected:font-medium">{o.label}</span>
                {o.detail && <span className="block text-meta text-slate-500">{o.detail}</span>}
              </span>
            </ListboxOption>
          ))}
        </ListboxOptions>
      </Listbox>
    </Field>
  );
}
