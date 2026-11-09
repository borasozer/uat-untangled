"use client";

import { Component, useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
// The kind `router.prefetch` takes for a whole page; Next.js does not export it anywhere else (as in fetch-on-intent.ts).
import { PrefetchKind } from "next/dist/client/components/router-reducer/router-reducer-types";
import { AiTag } from "../ui/ai-tag";
import { BoxHeader } from "../ui/box-header";
import { button } from "../ui/button";
import { Cross } from "../ui/icons";
import { RoleIcon } from "../ui/role-icons";
import { MISSING, STEPS, visible, type Side } from "./steps";
import { endTour, goToStep, hideInvite, setHowBuilt, startTour, useTour } from "./store";

/**
 * The guided tour: stops across the four views, each lighting one box of the page while the rest is dimmed. It only
 * shows: while it runs the page under it cannot be clicked or typed into (`inert`, and every key stops at the tour), so
 * nothing in the shared demo changes and no AI call is made. The person steps through it (Next and Back, the arrow keys,
 * Esc to leave); nothing moves by itself. On the way to another page the light first goes to the button that leads
 * there and presses it, so the page change is seen. Wide screens only: on a phone the pages are laid out differently.
 *
 * `?tour=start` opens it at the first step (for the demo video); `?tour=off` keeps the invitation away in this tab.
 */
export function Tour() {
  const { step } = useTour();
  useEffect(() => {
    const url = new URL(window.location.href);
    const ask = url.searchParams.get("tour");
    if (!ask) return;
    if (ask === "start" && matchMedia(WIDE).matches) startTour();
    if (ask === "off") hideInvite();
    url.searchParams.delete("tour");
    // After Next.js has taken over the history (its own effect runs after this one), keeping its state: otherwise Back to
    // this page would change the address but not the page.
    setTimeout(() => window.history.replaceState(window.history.state, "", url));
  }, []);
  if (step === null) return null;
  return (
    <TourBoundary>
      <Running index={step} />
    </TourBoundary>
  );
}

/** A screen wide enough for the tour (the header's view switch shows from here). */
export const WIDE = "(min-width: 64rem)";
/** The person's system asks for less motion: the light jumps, presses nothing on the way and does not wait. */
const calm = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
/** The next frame: the wait between looks for a step's box that is not on the page yet (3 s at most). */
const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

/** If the tour ever fails to draw, it goes and the page stays as it was. */
class TourBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(e: unknown) {
    console.error("The tour stopped", e);
    endTour();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/** Room around the lit box, in px. */
const PAD = 6;
/** Space between the lit box and the step's box, and kept above or below a box scrolled into view, in px. */
const GAP = 12;
/** The least distance between the step's box and the screen's edges, in px. */
const EDGE = 16;
/** The step's box never goes higher than this, so the header's view switch stays in sight (the header is 56 px). */
const TOP = 68;
/** Width of the step's box, in px. */
const WIDTH = 360;
/** The narrowest the step's box may go beside the lit box where room is short (Review at 1024 px), in px. */
const NARROW = 264;
/** The light's slide, in ms (as long as globals.css `.tour-hole[data-moving]`). */
const SLIDE = 320;
/** The light's press on a button on the way, in ms (globals.css `.tour-hole[data-press]`). */
const PRESS = 160;
/** The pause once a new page has come, before the light moves from the button to the step's box, in ms. */
const DWELL = 260;

/** What the light is on: a step's box (found again by name if the page redraws it), or a button on the way. */
type Aim = { el: HTMLElement | null; name: string | null; box: boolean; sides: Side[]; centre: boolean; high?: boolean; end?: boolean };

/**
 * The tour while it runs, at step `index`: the dimmed page with its light, and the step's box. When it goes (the tour
 * ended), the page is unlocked and the "How it's built" window closed.
 */
function Running({ index }: { index: number }) {
  const pathname = usePathname();
  const router = useRouter();
  const layer = useRef<HTMLDivElement>(null);
  const hole = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const main = useRef<HTMLButtonElement>(null);
  // The step the box shows (it changes when the light reaches that step's box), and whether that box is missing.
  const [shown, setShown] = useState<{ index: number; missing: boolean } | null>(null);
  const [busy, setBusy] = useState(true);
  const latest = useRef({ index, busy });
  useEffect(() => {
    latest.current = { index, busy };
  });
  const aim = useRef<Aim>({ el: null, name: null, box: false, sides: [], centre: true });

  // While the tour runs: the page locked, every key caught, and the light and the step's box kept on their aim every
  // frame (scrolling, a refresh that redraws the page, a window resized).
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.tour = "on";
    const own = layer.current!;
    // Everything in the body but the tour, and what arrives later (the header can come after the tour starts), the layer
    // the "How it's built" window opens in too: it only shows, so a stray click or Tab cannot close or change it.
    const locked = new Set<HTMLElement>();
    const lock = () => {
      for (const e of document.body.children) {
        if (!(e instanceof HTMLElement) || e === own || e.inert || e instanceof HTMLScriptElement) continue;
        e.inert = true;
        locked.add(e);
      }
    };
    lock();
    const watch = new MutationObserver(lock);
    watch.observe(document.body, { childList: true });
    // That window makes everything outside it inert, the tour too: the tour takes itself back.
    const keep = new MutationObserver(() => {
      if (own.inert) own.inert = false;
      if (own.hasAttribute("aria-hidden")) own.removeAttribute("aria-hidden");
    });
    keep.observe(own, { attributes: true, attributeFilter: ["inert", "aria-hidden"] });

    function onKey(e: KeyboardEvent) {
      const plain = !e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.repeat;
      if (e.key === "Escape") {
        e.preventDefault();
        endTour();
      } else if (plain && (e.key === "ArrowRight" || e.key === "ArrowLeft")) {
        e.preventDefault();
        const { index: at, busy: waiting } = latest.current;
        const to = at + (e.key === "ArrowRight" ? 1 : -1);
        if (!waiting && to >= 0 && to < STEPS.length) goToStep(to);
      }
      // Not prevented: Tab, Enter and Space still work on the tour's own buttons.
      e.stopPropagation();
    }
    window.addEventListener("keydown", onKey, true);
    const wide = matchMedia(WIDE);
    const onNarrow = () => !wide.matches && endTour();
    wide.addEventListener("change", onNarrow);

    const h = hole.current!;
    const b = box.current!;
    let last = "";
    let raf = 0;
    const tick = () => {
      const a = aim.current;
      if (a.name && !a.el?.isConnected) {
        const again = visible(`[data-tour="${a.name}"]`);
        if (again !== a.el) setShown((s) => (s && s.missing !== !again ? { ...s, missing: !again } : s));
        a.el = again;
      }
      // A button passed on the way that has gone with its page: the light stays where it was until the next aim.
      if (!a.name && !a.centre && !a.el?.isConnected) {
        raf = requestAnimationFrame(tick);
        return;
      }
      const lit = a.el ? visibleBox(a.el) : null;
      const at = !a.box ? null : lit ? place(lit, b.offsetHeight, a.sides, a.high, a.end) : a.centre ? centre(b.offsetHeight) : dock();
      const key = `${lit ? Object.values(lit).map(Math.round).join() : "closed"}|${at ? `${Math.round(at.x)},${Math.round(at.y)},${at.w}` : "-"}`;
      if (key !== last) {
        last = key;
        if (lit) {
          const radius = parseFloat(getComputedStyle(a.el!).borderTopLeftRadius) || 0;
          Object.assign(h.style, {
            top: `${lit.top - PAD}px`,
            left: `${lit.left - PAD}px`,
            width: `${lit.right - lit.left + 2 * PAD}px`,
            height: `${lit.bottom - lit.top + 2 * PAD}px`,
            borderRadius: `${radius + PAD}px`,
          });
          delete h.dataset.closed;
        } else {
          // Nothing to light: the whole page dimmed, the light closed to a point in the middle.
          Object.assign(h.style, { top: "50%", left: "50%", width: "0px", height: "0px", borderRadius: "0px" });
          h.dataset.closed = "";
        }
        h.dataset.on = "";
        if (at) {
          b.style.transform = `translate(${Math.round(at.x)}px, ${Math.round(at.y)}px)`;
          b.style.width = `${at.w}px`;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      watch.disconnect();
      keep.disconnect();
      window.removeEventListener("keydown", onKey, true);
      wide.removeEventListener("change", onNarrow);
      delete root.dataset.tour;
      setHowBuilt(false);
      // Headless UI puts back what it found when its window closes (our lock): the lock comes off after that.
      const unlock = () => locked.forEach((e) => (e.inert = false));
      let tries = 0;
      const after = () =>
        document.querySelector('[id^="headlessui-dialog"]') && tries++ < 90 ? requestAnimationFrame(after) : unlock();
      after();
      (document.activeElement as HTMLElement | null)?.blur();
    };
  }, []);

  // The page the tour is on, and a page change it did not make (Back, Forward), which ends it.
  const path = useRef(pathname);
  const expected = useRef<{ path: string; done: () => void } | null>(null);
  useEffect(() => {
    if (path.current === pathname) return;
    path.current = pathname;
    const e = expected.current;
    if (e?.path === pathname) {
      expected.current = null;
      e.done();
    } else endTour();
  }, [pathname]);

  // Each step: on the way, the light goes to the button that leads there and presses it; then the page changes (or the
  // window opens), the light goes to the step's box and the step's box comes. On the same page both slide there.
  const run = useRef(0);
  const shownOnce = useRef(false);
  useEffect(() => {
    const token = ++run.current;
    const alive = () => run.current === token;
    const s = STEPS[index];
    const motion = !calm();
    const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, motion ? ms : 0));
    const h = hole.current!;
    const b = box.current!;
    const slide = () => {
      if (!motion) return;
      h.dataset.moving = "";
      if (b.dataset.shown !== undefined) b.dataset.moving = "";
      setTimeout(() => {
        delete h.dataset.moving;
        delete b.dataset.moving;
      }, SLIDE + 40);
    };
    const to = (a: Partial<Aim>, sliding: boolean) => {
      aim.current = { el: null, name: null, box: false, sides: [], centre: false, ...a };
      if (sliding) slide();
    };
    void (async () => {
      setBusy(true);
      if (!s.opens) setHowBuilt(false);
      const away = path.current !== s.path;
      const via = shownOnce.current ? (s.via?.() ?? (away ? visible(`header [data-view="${s.view}"]`) : null)) : null;
      if (away || via) delete b.dataset.shown;
      if (away && !shownOnce.current) to({ centre: true }, false);
      if (via && motion) {
        reveal(via);
        to({ el: via }, true);
        await wait(SLIDE);
        if (!alive()) return;
        h.dataset.press = "";
        await wait(PRESS);
        delete h.dataset.press;
        if (!alive()) return;
      }
      if (away) {
        // A page slow to come: the step's box comes back after a while, so the tour can be left with a click too.
        const slowPage = setTimeout(() => alive() && (b.dataset.shown = ""), 5000);
        await new Promise<void>((done) => {
          expected.current = { path: s.path, done };
          router.push(s.path + (s.search ?? ""));
        });
        clearTimeout(slowPage);
        if (!alive()) return;
        if (via) await wait(DWELL);
        if (!alive()) return;
      }
      if (s.opens) {
        setHowBuilt(true, "server");
        await wait(220);
        if (!alive()) return;
      }
      let el: HTMLElement | null = null;
      if (s.target) {
        const until = performance.now() + 3000;
        while (alive() && !(el = visible(`[data-tour="${s.target}"]`)) && performance.now() < until) await frame();
        if (!alive()) return;
        if (el) reveal(el);
      }
      setShown({ index, missing: Boolean(s.target) && !el });
      to({ el, name: s.target ?? null, box: true, sides: s.sides, centre: !s.target, high: s.high, end: s.align === "end" }, shownOnce.current);
      b.dataset.shown = "";
      shownOnce.current = true;
      if (!b.contains(document.activeElement) && !document.activeElement?.closest('[role="dialog"]')) {
        main.current?.focus({ preventScroll: true });
      }
      // The pages a step away, fetched now so Next and Back do not wait (used for 30 s at most, next.config.ts).
      for (const n of [STEPS[index + 1], STEPS[index - 1]]) {
        if (n && n.path !== s.path) router.prefetch(n.path + (n.search ?? ""), { kind: PrefetchKind.FULL });
      }
      setBusy(false);
    })();
    // A step left halfway (the next one, or the tour ended): what it was still going to do is dropped.
    return () => {
      // The newest count on purpose: any sequence still running stops.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      run.current++;
    };
  }, [index, router]);

  const at = shown?.index ?? index;
  const now = STEPS[at];
  const last = at === STEPS.length - 1;
  const next = () => {
    if (busy) return;
    if (last) {
      endTour();
      router.push("/tester?as=T1");
      focusWhenThere('[data-tour="report"] textarea');
    } else goToStep(index + 1);
  };
  const back = () => !busy && index > 0 && goToStep(index - 1);

  return (
    <div ref={layer}>
      <div ref={hole} aria-hidden className="tour-hole" />
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        aria-describedby="tour-body"
        className="tour-box"
      >
        <div className="tour-card overflow-hidden rounded-lg border border-slate-300 bg-white shadow-[0_10px_30px_rgba(15,23,42,0.18)]">
          <BoxHeader
            className="pr-1.5 pl-4"
            icon={now.icon === "ai" ? <AiTag /> : <RoleIcon role={now.icon} />}
            title={now.title}
            titleId="tour-title"
            end={
              <button
                type="button"
                onClick={endTour}
                aria-label="End the tour"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-800"
              >
                <Cross className="h-4 w-4" />
              </button>
            }
          />
          <p key={at} id="tour-body" className="fade-in px-4 pt-3 text-sm text-slate-700">
            {shown?.missing ? MISSING : now.body}
          </p>
          {/* The count by the buttons, not in the title band: a long title must never squeeze it onto two lines. */}
          <div className="flex items-center gap-2 px-4 py-3">
            <span className="mr-auto text-meta whitespace-nowrap text-slate-500 tabular-nums">
              {at + 1} of {STEPS.length}
            </span>
            {at > 0 && (
              <button type="button" onClick={back} aria-disabled={busy} className={button("secondary", "sm")}>
                Back
              </button>
            )}
            {last && (
              <button
                type="button"
                onClick={() => {
                  // Done: back to where the tour began, the Overview.
                  endTour();
                  router.push("/");
                }}
                className={button("secondary", "sm")}
              >
                Done
              </button>
            )}
            <button ref={main} type="button" onClick={next} aria-disabled={busy} className={button("primary", "sm")}>
              {last ? "Write a report" : "Next"}
            </button>
          </div>
          <span className="sr-only" aria-live="polite">
            {`Step ${at + 1} of ${STEPS.length}. ${now.title}. ${shown?.missing ? MISSING : now.body}`}
          </span>
        </div>
      </div>
    </div>
  );
}

/** Puts the cursor in a field of the page that is on the way, once it is there (for 4 s at most). */
function focusWhenThere(selector: string) {
  const until = performance.now() + 4000;
  const look = () => {
    const el = document.querySelector<HTMLElement>(selector);
    if (el && !el.closest("[inert]")) el.focus();
    else if (performance.now() < until) requestAnimationFrame(look);
  };
  requestAnimationFrame(look);
}

type Box = { top: number; left: number; right: number; bottom: number };

/** Ancestors that clip the box (`all`: also those that only hide what overflows; those are never scrolled). */
function clippers(el: Element, all = false): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const y = getComputedStyle(p).overflowY;
    if (((y === "auto" || y === "scroll") && p.scrollHeight > p.clientHeight) || (all && y === "hidden")) out.push(p);
  }
  return out;
}

/** The part of the box a person can see: inside each scrolling panel and the window. */
function visibleBox(el: Element): Box | null {
  const r = el.getBoundingClientRect();
  let b: Box = { top: r.top, left: r.left, right: r.right, bottom: r.bottom };
  for (const c of clippers(el, true).map((p) => p.getBoundingClientRect())) {
    b = { top: Math.max(b.top, c.top), left: Math.max(b.left, c.left), right: Math.min(b.right, c.right), bottom: Math.min(b.bottom, c.bottom) };
  }
  b = { top: Math.max(b.top, 0), left: Math.max(b.left, 0), right: Math.min(b.right, innerWidth), bottom: Math.min(b.bottom, innerHeight) };
  return b.bottom - b.top < 8 || b.right - b.left < 8 ? null : b;
}

/** Scrolls only what has to scroll (inner panels first, then the window), at once, so the box's top is in view. */
function reveal(el: Element) {
  const page = document.scrollingElement as HTMLElement;
  for (const s of [...clippers(el), page]) {
    const c = s === page ? { top: TOP, bottom: innerHeight } : s.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    if (r.top < c.top + GAP || r.height > c.bottom - c.top - 2 * GAP) s.scrollTop += r.top - (c.top + GAP);
    else if (r.bottom > c.bottom - GAP) s.scrollTop += r.bottom - (c.bottom - GAP);
  }
}

/**
 * Where the step's box goes, and how wide: the first side, in the step's order, where it fits whole (beside the box it
 * may be narrower); else the corner under the header that covers least of the lit box.
 */
function place(lit: Box, h: number, sides: Side[], high = false, end = false): { x: number; y: number; w: number } {
  const w = WIDTH;
  const x = (v: number) => Math.min(Math.max(v, EDGE), innerWidth - w - EDGE);
  const y = (v: number) => Math.min(Math.max(v, TOP), innerHeight - h - EDGE);
  const o = { top: lit.top - PAD, left: lit.left - PAD, right: lit.right + PAD, bottom: lit.bottom + PAD };
  // Above or below the lit box, the step's box lines up with its left edge, or its right edge (`end`).
  const along = x(end ? o.right - w : o.left);
  const roomLeft = o.left - GAP - EDGE;
  const roomRight = innerWidth - EDGE - o.right - GAP;
  for (const side of sides) {
    if (side === "bottom" && o.bottom + GAP + h <= innerHeight - EDGE) return { x: along, y: Math.max(o.bottom + GAP, TOP), w };
    if (side === "top" && o.top - GAP - h >= (high ? EDGE : TOP)) return { x: along, y: o.top - GAP - h, w };
    if (side === "right" && roomRight >= NARROW) return { x: o.right + GAP, y: y(o.top), w: Math.min(w, roomRight) };
    if (side === "left" && roomLeft >= NARROW) {
      const n = Math.min(w, roomLeft);
      return { x: o.left - GAP - n, y: y(o.top), w: n };
    }
  }
  const corners = [
    { x: EDGE, y: TOP },
    { x: innerWidth - w - EDGE, y: TOP },
    { x: EDGE, y: innerHeight - h - EDGE },
    { x: innerWidth - w - EDGE, y: innerHeight - h - EDGE },
  ];
  const covered = (c: { x: number; y: number }) =>
    Math.max(0, Math.min(c.x + w, o.right) - Math.max(c.x, o.left)) * Math.max(0, Math.min(c.y + h, o.bottom) - Math.max(c.y, o.top));
  const best = corners.reduce((a, c) => (covered(c) < covered(a) ? c : a));
  return { ...best, w };
}

/** The step's box's own corner: top right, under the header, in line with the page's right edge. */
function dock(): { x: number; y: number; w: number } {
  const row = document.querySelector("header .app-container > div")?.getBoundingClientRect();
  return { x: Math.max((row?.right ?? innerWidth - EDGE) - WIDTH, EDGE), y: TOP, w: WIDTH };
}

/** The middle of the screen, for a step with nothing to light. */
function centre(h: number): { x: number; y: number; w: number } {
  return { x: (innerWidth - WIDTH) / 2, y: Math.max(TOP, (innerHeight - h) / 2), w: WIDTH };
}
