"use client";

import { cloneElement, isValidElement, useEffect, useId, useRef, useState, type FocusEvent, type KeyboardEvent, type MouseEvent, type ReactElement, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** The look of the app's own notes: a white box like the app's boxes (the (i) notes and `Tip`), never the browser's tooltip. */
export const TIP_BOX =
  "rounded-md border border-box-line bg-white px-2.5 py-2 text-[12.5px] leading-[1.125rem] text-slate-700 shadow-[0_10px_30px_rgba(15,23,42,0.18)]";

/** The props Tip puts on its element; the element's own event handlers of the same names still run, before Tip's. */
type Handlers = {
  onMouseEnter?: (e: MouseEvent<HTMLElement>) => void;
  onMouseLeave?: (e: MouseEvent<HTMLElement>) => void;
  onFocus?: (e: FocusEvent<HTMLElement>) => void;
  onBlur?: (e: FocusEvent<HTMLElement>) => void;
  onKeyDown?: (e: KeyboardEvent<HTMLElement>) => void;
  "aria-describedby"?: string;
  tabIndex?: number;
};

/**
 * A short note on an element, shown in the app's own box as a mouse rests on it (a quarter of a second) or the keyboard
 * reaches it; Esc or leaving hides it. Added to the element itself (no wrapper, so nothing in the layout changes).
 * `reach`: the element cannot take focus by itself (a label, a box), so it is made reachable by the keyboard for its note.
 */
export function Tip({ text, children, reach = false }: { text: ReactNode; children: ReactElement<Handlers>; reach?: boolean }) {
  const id = useId();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [at, setAt] = useState<{ left: number; top?: number; bottom?: number } | null>(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const show = (el: HTMLElement) => {
    clearTimeout(timer.current);
    // The fallback wrapper below draws no box of its own: measure what it holds.
    const r = (getComputedStyle(el).display === "contents" ? (el.firstElementChild ?? el) : el).getBoundingClientRect();
    const width = Math.min(360, innerWidth - 16);
    const left = Math.min(Math.max(r.left, 8), innerWidth - width - 8);
    // Below the element, or above it when there is little room below.
    setAt(r.bottom + 120 > innerHeight ? { left, bottom: innerHeight - r.top + 6 } : { left, top: r.bottom + 6 });
  };
  const hide = () => {
    clearTimeout(timer.current);
    setAt(null);
  };
  // From a server page, an element can arrive still loading (a lazy reference, not an element): it cannot be cloned,
  // so it gets a wrapper that adds no box.
  const element = isValidElement<Handlers>(children) ? children : null;
  const p: Handlers = element?.props ?? {};
  const handlers: Handlers = {
    onMouseEnter: (e) => {
      p.onMouseEnter?.(e);
      const el = e.currentTarget;
      clearTimeout(timer.current);
      timer.current = setTimeout(() => show(el), 250);
    },
    onMouseLeave: (e) => {
      p.onMouseLeave?.(e);
      hide();
    },
    onFocus: (e) => {
      p.onFocus?.(e);
      // The element itself, or a link inside it, reached by the keyboard.
      if (e.currentTarget.matches(":focus-visible, :has(:focus-visible)")) show(e.currentTarget);
    },
    onBlur: (e) => {
      p.onBlur?.(e);
      hide();
    },
    onKeyDown: (e) => {
      p.onKeyDown?.(e);
      if (e.key === "Escape") hide();
    },
    "aria-describedby": at ? id : p["aria-describedby"],
    ...(reach && { tabIndex: 0 }),
  };
  const target = element ? (
    // The handlers read the timer only when an event comes, never while drawing (the rule cannot tell).
    // eslint-disable-next-line react-hooks/refs
    cloneElement(element, handlers)
  ) : (
    <span className="contents" {...handlers}>
      {children}
    </span>
  );
  return (
    <>
      {target}
      {at &&
        createPortal(
          <span
            id={id}
            role="tooltip"
            style={{ left: at.left, top: at.top, bottom: at.bottom }}
            className={`fade-in pointer-events-none fixed z-50 block w-max max-w-[min(22.5rem,calc(100vw-1rem))] ${TIP_BOX}`}
          >
            {text}
          </span>,
          document.body,
        )}
    </>
  );
}
