"use client";

import Link, { useLinkStatus } from "next/link";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Menu, MenuButton, MenuItem, MenuItems } from "@headlessui/react";
import type { ArchitectureFacts } from "@/lib/architecture";
import { useFetchOnIntent } from "./fetch-on-intent";
import { HowItsBuilt } from "./how-its-built";
import { HOW_BUILT_EVENT, startTour, type HowBuilt } from "./tour/store";
import { Route } from "./ui/icons";
import { Logo } from "./logo";
import { RoleIcon, type Role } from "./ui/role-icons";
import { SteadyLabel } from "./ui/busy-label";
import { ChevronDown } from "./ui/icons";
import { LinkArrow } from "./ui/link-arrow";
import { Select } from "./ui/select";

/**
 * The header on every page (layout.tsx gives it its data from the server): the logo, the four views (Overview, Tester,
 * Manager, Developer), the current view's tabs, the person it is seen as, Tour and "How it's built". There is no sign-in:
 * the view follows the address, and in the tester's view the "You are" menu sets `?as=` in it. Below 1024 px the view
 * switch becomes a menu, and the tabs and the person move to a second row.
 *
 * VIEWS: each view, its first page and its tabs.
 * viewOf: the view a page belongs to.
 * Nav: the header itself, and the "How it's built" window, which the tour can open and close too.
 * Diagram: the icon that stands for "How it's built" where its words do not fit.
 * ViewSwitch: the four views side by side.
 * withGesture: plays an icon's short gesture as a mouse or the keyboard arrives.
 * ViewMark: the white mark under the current view, which slides when the view changes.
 * ViewMenu: the view switch as a menu.
 * Initials: a person's initials in a circle.
 * PersonChip: the manager or the developer, by name and role.
 * TesterChip: the "You are" menu in the tester's view.
 */

export type NavPerson = { id: string; name: string; team: string };

/** The four views, set on the view switch's buttons as `data-view` for the view mark and the tour to find. */
type ViewId = "overview" | "tester" | "manager" | "developer";

/** Each page belongs to exactly one person's view, so a link or the back button always shows the right person. */
const VIEWS: { id: ViewId; label: string; href: string; role: Role; tabs: { href: string; label: string }[] }[] = [
  { id: "overview", label: "Overview", href: "/", role: "overview", tabs: [] },
  { id: "tester", label: "Tester", href: "/tester", role: "tester", tabs: [{ href: "/tester", label: "New report" }] },
  {
    id: "manager",
    label: "Manager",
    href: "/review",
    role: "manager",
    tabs: [
      { href: "/review", label: "Review" },
      { href: "/import", label: "Import" },
      { href: "/insights", label: "Insights" },
    ],
  },
  { id: "developer", label: "Developer", href: "/tickets", role: "developer", tabs: [{ href: "/tickets", label: "Tickets" }] },
];

/** By the address alone: a ticket's page is the Developer's, and any address not listed here is the Overview's. */
function viewOf(pathname: string): ViewId {
  if (pathname.startsWith("/tester")) return "tester";
  if (/^\/(review|import|insights)(\/|$)/.test(pathname)) return "manager";
  if (pathname.startsWith("/tickets")) return "developer";
  return "overview";
}

/**
 * The header, and the "How it's built" window it opens; the tour opens and closes that window too (HOW_BUILT_EVENT).
 * A person missing from the props (the database out of reach, layout.tsx) only leaves their chip out.
 */
export function Nav({
  testers,
  manager,
  developer,
  facts,
}: {
  testers: NavPerson[];
  manager: NavPerson | null;
  developer: NavPerson | null;
  /** For the "How it's built" window, on every page. */
  facts: ArchitectureFacts;
}) {
  const [built, setBuilt] = useState(false);
  // The tour opens and closes the window too; opened by it, the window starts afresh on its first tab, with the part it
  // asks for.
  const [fresh, setFresh] = useState<{ n: number; part?: HowBuilt["part"] }>({ n: 0 });
  useEffect(() => {
    const on = (e: Event) => {
      const { open, part } = (e as CustomEvent<HowBuilt>).detail;
      if (open) setFresh((f) => ({ n: f.n + 1, part }));
      setBuilt(open);
    };
    window.addEventListener(HOW_BUILT_EVENT, on);
    return () => window.removeEventListener(HOW_BUILT_EVENT, on);
  }, []);
  // Opened from the header: as it was left, unless the tour last opened it (then afresh, on the AI's part).
  const openBuilt = () => {
    setFresh((f) => (f.part ? { n: f.n + 1 } : f));
    setBuilt(true);
  };
  const pathname = usePathname();
  const fetchOnIntent = useFetchOnIntent();
  const current = VIEWS.find((v) => v.id === viewOf(pathname))!;
  const chip =
    current.id === "tester" ? (
      <TesterChip testers={testers} />
    ) : current.id === "manager" ? (
      <PersonChip person={manager} role="UAT manager" />
    ) : current.id === "developer" ? (
      <PersonChip person={developer} role="Developer" />
    ) : null;

  const tabs = current.tabs.length > 0 && (
    <nav aria-label={`${current.label} pages`} className="flex items-stretch gap-5 self-stretch text-sm">
      {current.tabs.map((t) => {
        const active = pathname === t.href || pathname.startsWith(`${t.href}/`);
        return (
          <Link
            key={t.href}
            href={t.href}
            {...fetchOnIntent(t.href)}
            // On a page under the tab (one ticket), the tab is the current section, not the current page.
            aria-current={pathname === t.href ? "page" : active ? "true" : undefined}
            className={`-mb-px flex items-center border-b-2 whitespace-nowrap ${
              active ? "border-accent font-medium text-slate-900" : "border-transparent text-slate-600 hover:text-slate-900"
            }`}
          >
            <SteadyLabel weight="font-medium">{t.label}</SteadyLabel>
          </Link>
        );
      })}
    </nav>
  );

  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="app-container">
        <div className="flex h-12 items-center gap-5 lg:h-14">
          <Link
            href="/"
            {...withGesture(fetchOnIntent("/"))}
            className="flex shrink-0 items-center gap-2 font-semibold text-slate-900"
          >
            <Logo className="h-5 w-5" />
            Untangle
          </Link>
          <ViewSwitch current={current.id} className="hidden lg:flex" />
          {tabs && <div className="hidden h-full border-l border-slate-200 pl-5 lg:flex">{tabs}</div>}
          {chip && <div className="ml-auto hidden min-w-0 lg:block">{chip}</div>}
          {/* The guided tour, again (components/tour). Below xl a person's view has no room for it: the Overview does. */}
          <button
            type="button"
            onClick={() => startTour()}
            {...withGesture({ onFocus: () => {} })}
            className={`hidden shrink-0 items-center gap-1.5 text-sm font-medium whitespace-nowrap text-accent hover:underline ${
              chip ? "border-l border-slate-200 pl-5 xl:flex" : "ml-auto lg:flex"
            }`}
          >
            <Route className="h-4 w-4" />
            Tour
          </button>
          <button
            type="button"
            onClick={openBuilt}
            data-tour="how-built"
            className={`hidden shrink-0 text-sm font-medium whitespace-nowrap text-accent hover:underline ${
              chip ? "xl:block" : "lg:block"
            }`}
          >
            How it&apos;s built
            <LinkArrow />
          </button>
          {/* Where the words do not fit (a phone, or a person's view below xl): the same button as an icon. */}
          <button
            type="button"
            onClick={openBuilt}
            aria-label="How it's built"
            title="How it's built"
            data-tour="how-built"
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 ${
              chip ? "ml-auto lg:ml-0 xl:hidden" : "ml-auto lg:hidden"
            }`}
          >
            <Diagram className="h-5 w-5" />
          </button>
          <ViewMenu current={current.id} className="lg:hidden" />
        </div>
        {(tabs || chip) && (
          <div className="flex h-11 items-center gap-4 border-t border-slate-100 lg:hidden">
            {tabs}
            {chip && <div className="ml-auto min-w-0">{chip}</div>}
          </div>
        )}
      </div>
      <HowItsBuilt
        key={fresh.n}
        startPart={fresh.part}
        facts={facts}
        open={built}
        // Opened by the tour, the window closes with the tour's step, never with a stray click.
        onClose={() => !document.documentElement.dataset.tour && setBuilt(false)}
      />
    </header>
  );
}

/** Three boxes and their links: the "How it's built" drawing in small. */
function Diagram({ className }: { className: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="2.5" y="3.5" width="7" height="5" rx="1" />
      <rect x="14.5" y="3.5" width="7" height="5" rx="1" />
      <rect x="8.5" y="15.5" width="7" height="5" rx="1" />
      <path d="M9.5 6h5M12 6v9.5" />
    </svg>
  );
}

/**
 * Whose eyes the app is seen through. Each choice opens that person's first page. A white mark sits under the current
 * view; the label keeps the room its bold needs, so nothing shifts when the view changes.
 */
function ViewSwitch({ current, className = "" }: { current: ViewId; className?: string }) {
  const fetchOnIntent = useFetchOnIntent();
  return (
    <nav aria-label="View as" data-views data-tour="views" className={`isolate items-center gap-0.5 rounded-md bg-slate-100 p-0.5 text-sm ${className}`}>
      {VIEWS.map((v) => (
        <Link
          key={v.id}
          href={v.href}
          {...withGesture(fetchOnIntent(v.href))}
          data-view={v.id}
          aria-current={v.id === current ? "true" : undefined}
          className={`relative inline-flex items-center gap-1.5 rounded px-3 py-1 transition-colors duration-150 ${
            v.id === current ? "font-semibold text-accent" : "text-slate-600 hover:text-slate-900"
          }`}
        >
          <ViewMark view={v.id} current={v.id === current} />
          <RoleIcon role={v.role} />
          <SteadyLabel weight="font-semibold">{v.label}</SteadyLabel>
        </Link>
      ))}
    </nav>
  );
}

/**
 * A link or button whose icon plays its short gesture (globals.css, `[data-play]`) as a mouse arrives on it, or the
 * keyboard's focus does: the view switch's buttons, the logo and Tour. It plays to its end even if the pointer leaves at
 * once, and arriving again while it plays does not start it over. `link` is its other handlers (useFetchOnIntent).
 */
function withGesture<T extends { onFocus: () => void }>(link: T) {
  function play(el: HTMLElement) {
    if (el.hasAttribute("data-play") || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const stop = new AbortController();
    const done = () => {
      el.removeAttribute("data-play");
      stop.abort();
      clearTimeout(timer);
    };
    el.addEventListener("animationend", done, { signal: stop.signal });
    // Hidden halfway (the switch below 1024 px), it stops without `animationend`, and not every browser sends
    // `animationcancel`: taken off after a second anyway, so it does not play again by itself when shown.
    el.addEventListener("animationcancel", done, { signal: stop.signal });
    const timer = setTimeout(done, 1000);
    el.setAttribute("data-play", "");
  }
  return {
    ...link,
    onPointerEnter: (e: React.PointerEvent<HTMLElement>) => {
      if (e.pointerType !== "touch") play(e.currentTarget);
    },
    onFocus: (e: React.FocusEvent<HTMLElement>) => {
      link.onFocus();
      if (e.currentTarget.matches(":focus-visible")) play(e.currentTarget);
    },
  };
}

/**
 * The white mark under a view. It shows under the view just chosen at the click, while its page is still on the way
 * (every page is rendered fresh; useFetchOnIntent starts it at the pointer, so it is often there at once), and under the
 * current view otherwise (globals.css, `.view-mark`). When it moves (a click, Back or Forward, any link to another view)
 * it slides from where it was. Not on the first paint, and not for a person who asks for less motion.
 */
function ViewMark({ view, current }: { view: ViewId; current: boolean }) {
  const { pending } = useLinkStatus();
  const ref = useRef<HTMLSpanElement>(null);
  const wasPending = useRef(false);
  useLayoutEffect(() => {
    const mark = ref.current;
    const nav = mark?.closest<HTMLElement>("[data-views]");
    const was = wasPending.current;
    wasPending.current = pending;
    if (!mark || !nav) return;
    if (!(current || pending)) {
      // A choice given up before its page came, for a link outside the switch (the logo, a card's link): the mark is back
      // under the current view. Not when another view was chosen instead: that one slides on from here.
      if (was && nav.dataset.shown === view && !nav.querySelector(".view-mark[data-pending]")) {
        nav.dataset.shown = nav.querySelector<HTMLElement>("[aria-current]")?.dataset.view;
      }
      return;
    }
    const from = nav.dataset.shown;
    nav.dataset.shown = view;
    if (!from || from === view || !nav.offsetParent || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const old = nav.querySelector<HTMLElement>(`[data-view="${from}"] > .view-mark`);
    if (!old) return;
    // Where the old mark is now, even halfway through its own slide.
    const a = old.getBoundingClientRect();
    const b = mark.getBoundingClientRect();
    old.getAnimations().forEach((x) => x.cancel());
    mark.animate([{ left: `${a.left - b.left}px`, right: `${b.right - a.right}px` }, { left: "0px", right: "0px" }], {
      duration: 240,
      easing: "cubic-bezier(0.2, 0, 0, 1)",
    });
  }, [view, current, pending]);
  return (
    <span
      ref={ref}
      aria-hidden
      data-pending={pending || undefined}
      className="view-mark pointer-events-none absolute inset-0 -z-10 rounded bg-white shadow-sm ring-1 ring-slate-200"
    />
  );
}

/** The same choice below 1024 px (a phone or a narrow window), where four buttons do not fit. */
function ViewMenu({ current, className = "" }: { current: ViewId; className?: string }) {
  const label = VIEWS.find((v) => v.id === current)!.label;
  return (
    <Menu as="div" className={className}>
      <MenuButton className="flex h-9 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-800">
        <span className="text-slate-500">View:</span> {label}
        <ChevronDown className="h-4 w-4 text-slate-500" />
      </MenuButton>
      <MenuItems
        anchor={{ to: "bottom end", gap: 4, padding: 8 }}
        className="z-50 min-w-44 rounded-md border border-slate-200 bg-white p-1 text-sm shadow-lg focus:outline-none"
      >
        {VIEWS.map((v) => (
          <MenuItem key={v.id}>
            <Link
              href={v.href}
              aria-current={v.id === current ? "true" : undefined}
              className="flex items-center gap-2 rounded px-3 py-2 text-slate-800 data-focus:bg-slate-100 aria-[current]:font-medium"
            >
              <RoleIcon role={v.role} className="h-4 w-4 text-slate-500" />
              {v.label}
            </Link>
          </MenuItem>
        ))}
      </MenuItems>
    </Menu>
  );
}

/** Up to two initials in a grey circle, a "Dr" left out (Dr James Whitfield: JW). Hidden from screen readers. */
function Initials({ name }: { name: string }) {
  const letters = name
    .replace(/^Dr\.?\s+/i, "")
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join("");
  return (
    <span
      aria-hidden
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-200 text-[11px] font-semibold text-slate-700"
    >
      {letters}
    </span>
  );
}

function PersonChip({ person, role }: { person: NavPerson | null; role: string }) {
  if (!person) return null;
  return (
    <span className="flex items-center gap-2 text-sm">
      <Initials name={person.name} />
      <span className="truncate">
        <span className="font-medium text-slate-900">{person.name}</span>
        <span className="text-slate-500 max-sm:hidden lg:max-xl:hidden"> · {role}</span>
      </span>
    </span>
  );
}

/** In the tester's view the chip picks which tester you are (a demo device: there is no sign-in). */
function TesterChip({ testers }: { testers: NavPerson[] }) {
  const router = useRouter();
  const params = useSearchParams();
  const me = testers.find((t) => t.id === params.get("as")) ?? testers[0];
  if (!me) return null;
  return (
    <div className="flex items-center gap-2">
      <span className="text-meta text-slate-500 max-sm:hidden lg:max-xl:hidden">You are</span>
      <Initials name={me.name} />
      <Select
        label="You are"
        hideLabel
        value={me.id}
        onChange={(id) => router.push(`/tester?as=${id}`)}
        options={testers.map((t) => ({ value: t.id, label: t.name, detail: t.team }))}
        buttonClassName="h-8 pl-2.5 max-sm:h-9"
        className="w-fit max-w-56"
      />
    </div>
  );
}
