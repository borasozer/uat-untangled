import type { ReactNode } from "react";

/**
 * The title bar of a box: the same height, grey band and line under it in every box, with a small icon before
 * the title, so each part of a page reads as a named part at first glance. The box clips the corners (overflow-hidden).
 */
export function BoxHeader({
  icon,
  title,
  titleId,
  titleClassName = "",
  detail,
  end,
  className = "px-4",
}: {
  icon: ReactNode;
  title: ReactNode;
  /** For the box's aria-labelledby. */
  titleId?: string;
  /** E.g. kept for screen readers only where a phone shows the same words above the box. */
  titleClassName?: string;
  /** Short words after the title, on the same line. */
  detail?: ReactNode;
  /** Pushed to the right end of the bar: a few words or a small button. */
  end?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={`relative flex min-h-10 shrink-0 items-center justify-between gap-x-4 gap-y-0.5 border-b border-band-line bg-band py-0.75 max-sm:flex-wrap ${className}`}
    >
      {/* One line from a small tablet up, so the bar keeps its height from box to box: the title keeps its words (with
          something at the end, the title side takes up to 80% of the bar and the end gives way first). A phone wraps.
          The 3 px padding leaves a small button (32 px) inside the 40 px. */}
      <div className={`flex max-w-full shrink-0 items-center gap-2 ${end ? "sm:max-w-[80%]" : ""}`}>
        <span className="flex shrink-0 text-slate-500 [&>svg]:size-[17px]">{icon}</span>
        <h2 id={titleId} className={`min-w-0 text-[15px] font-semibold text-slate-900 sm:shrink-0 ${titleClassName}`}>
          {title}
        </h2>
        {detail}
      </div>
      {end}
    </header>
  );
}
