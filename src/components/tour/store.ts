"use client";

import { useSyncExternalStore } from "react";

/**
 * Whether the tour is running and at which step, shared by the tour itself, the header's "Tour" button and the
 * Overview's invitation (one small store, outside React, so any of them can start it).
 */
type State = { step: number | null };

let state: State = { step: null };
const listeners = new Set<() => void>();
const SERVER: State = { step: null };

/** Every change goes through here, always as a new object (React compares by identity), and every reader is told. */
function set(next: State) {
  state = next;
  listeners.forEach((l) => l());
}

/** Starts at the first step. Counts as having seen the invitation, so the Overview does not offer the tour again. */
export function startTour() {
  remember("seen");
  set({ step: 0 });
}
export function goToStep(step: number) {
  if (state.step !== null) set({ step });
}
export function endTour() {
  if (state.step !== null) set({ step: null });
}

/** The tour's state for a component. Always off on the server and in the first paint, so the page hydrates the same. */
export function useTour(): State {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => SERVER,
  );
}

/* Whether this browser has seen the invitation. A browser that blocks site data throws on storage: kept in memory then. */
const KEY = "untangle.tour.v1";
let memory: string | null = null;
export function seenBefore(): boolean {
  try {
    return (localStorage.getItem(KEY) ?? memory) !== null;
  } catch {
    return memory !== null;
  }
}
/** "seen" when the invitation shows or the tour starts, "skipped" on Skip. Either keeps the invitation away. */
export function remember(value: "seen" | "skipped") {
  memory = value;
  try {
    localStorage.setItem(KEY, value);
  } catch {
    // Kept in memory for this visit.
  }
}

/** `?tour=off` (for the demo video): no invitation in this tab. */
let off = false;
/** Kept for the tab's life: the tour takes `?tour=off` out of the address once it has read it. */
export function hideInvite() {
  off = true;
  try {
    sessionStorage.setItem("untangle.tour.off", "1");
  } catch {
    // Kept in memory for this visit.
  }
}
/** Reads the address too: the Overview's invitation may check before the tour has read `?tour=off` (hideInvite). */
export function inviteHidden(): boolean {
  if (off || new URLSearchParams(window.location.search).get("tour") === "off") return true;
  try {
    return sessionStorage.getItem("untangle.tour.off") === "1";
  } catch {
    return false;
  }
}

/**
 * The header's "How it's built" window, opened and closed by the tour (nav.tsx listens). `part`: the part chosen when it
 * opens (the tour chooses the server, so every connection shows).
 */
export const HOW_BUILT_EVENT = "untangle:how-its-built";
export type HowBuilt = { open: boolean; part?: "server" };
/** By an event on `window`, so the tour opens and closes the window without reaching into the header. */
export function setHowBuilt(open: boolean, part?: HowBuilt["part"]) {
  window.dispatchEvent(new CustomEvent<HowBuilt>(HOW_BUILT_EVENT, { detail: { open, part } }));
}
