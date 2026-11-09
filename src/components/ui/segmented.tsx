"use client";

/**
 * The side-by-side choice the forms share: "Did it work?" on the tester's screen, and in Review how a report relates to
 * its ticket and a new ticket's severity.
 */

export type SegmentedOption<T extends string> = { value: T; label: React.ReactNode; title?: string };

/**
 * A few choices side by side, all visible at once. Built on native radio buttons, so arrow keys move between
 * the choices and screen readers announce a radio group.
 */
export function Segmented<T extends string>({
  legend,
  hideLegend = false,
  name,
  value,
  onChange,
  options,
  className = "",
  disabled = false,
}: {
  legend: string;
  hideLegend?: boolean;
  name: string;
  value: T | null;
  onChange: (value: T) => void;
  options: SegmentedOption<T>[];
  className?: string;
  disabled?: boolean;
}) {
  return (
    // Relative, so its hidden legend and radio inputs stay inside a scrolling box instead of stretching the page.
    <fieldset disabled={disabled} className={`relative min-w-0 ${className}`}>
      <legend className={hideLegend ? "sr-only" : "mb-1 text-meta font-medium text-slate-700"}>{legend}</legend>
      <div className="inline-flex max-w-full flex-wrap gap-0.5 rounded-md border border-slate-300 bg-white p-0.5">
        {options.map((o) => (
          <label
            key={o.value}
            title={o.title}
            className="relative cursor-pointer rounded px-3 py-1 has-disabled:cursor-default has-disabled:opacity-60 text-sm whitespace-nowrap text-slate-700 hover:bg-slate-100 has-checked:bg-white has-checked:text-accent-fill has-checked:inset-ring-[1.5px] has-checked:inset-ring-accent has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-1 has-[:focus-visible]:outline-accent max-sm:py-1.5"
          >
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={value === o.value}
              onChange={() => onChange(o.value)}
              className="sr-only"
            />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
