"use client";

import { useEffect, useRef, useState } from "react";
import { button } from "../ui/button";
import { inviteHidden, remember, seenBefore, startTour, useTour } from "./store";

/**
 * The Overview's offer of the tour, the first time this browser comes: a card beside the title, never over the steps.
 * Half a second after the page shows, the page dims around it like a tour step, so it is seen; the first click, key or
 * scroll anywhere takes the dim away and still does what it was meant to (nothing is blocked, nothing takes focus). The
 * card stays until Start or Skip. Shown once (seeing it counts); the header's "Tour" button stays. Wide screens with a
 * mouse only (the tour itself asks only for a wide screen).
 */
export function TourInvite() {
  const { step } = useTour();
  const [open, setOpen] = useState(false);
  const card = useRef<HTMLElement>(null);
  useEffect(() => {
    // After the first paint: only the browser knows whether it has been offered before.
    if (inviteHidden() || seenBefore() || !matchMedia("(min-width: 64rem) and (hover: hover)").matches) return;
    remember("seen");
    setOpen(true); // eslint-disable-line react-hooks/set-state-in-effect -- read from the browser after hydration
  }, []);
  useEffect(() => {
    const el = card.current;
    if (!open || !el || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const events = ["pointerdown", "keydown", "wheel", "touchstart"] as const;
    const off = () => {
      clearTimeout(timer);
      delete el.dataset.lit;
      events.forEach((t) => window.removeEventListener(t, off, true));
    };
    const timer = setTimeout(() => (el.dataset.lit = ""), 500);
    events.forEach((t) => window.addEventListener(t, off, { capture: true, passive: true }));
    return off;
  }, [open]);
  if (!open || step !== null) return null;
  return (
    <section
      ref={card}
      aria-labelledby="tour-invite-title"
      className="tour-invite fade-in absolute top-0 right-0 z-40 w-90 rounded-lg border border-box-line bg-white px-4 py-3 shadow-box"
    >
      <p className="text-sm text-slate-700">
        <strong id="tour-invite-title" className="font-semibold text-slate-900">
          New here?
        </strong>{" "}
        A short tour of the four views.
      </p>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            startTour();
          }}
          className={button("primary", "sm")}
        >
          Start the tour
        </button>
        <button
          type="button"
          onClick={() => {
            remember("skipped");
            setOpen(false);
          }}
          className={button("secondary", "sm")}
        >
          Skip
        </button>
      </div>
    </section>
  );
}
