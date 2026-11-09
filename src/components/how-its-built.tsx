"use client";

import Link from "next/link";
import { useEffect, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { Dialog, DialogBackdrop, DialogPanel, DialogTitle, Tab, TabGroup, TabList, TabPanel, TabPanels } from "@headlessui/react";
import { TABLE_GROUPS, TABLE_NOTE, type ArchitectureFacts } from "@/lib/architecture";
import { ACTION_LABEL, firstName } from "@/lib/labels";
import { SteadyLabel } from "./ui/busy-label";
import { LinkArrow } from "./ui/link-arrow";
import { ROLE_ICONS, ROLE_PATHS } from "./ui/role-icons";

/**
 * "How it's built": the parts of the app as a drawing, one real sample report followed from the tester's words to a fix,
 * and why to trust a suggestion. Few words on purpose: a box is an icon and a name; clicking it gives one sentence and
 * the technical names.
 */
export function HowItsBuilt({
  facts,
  open,
  onClose,
  startPart = "ai",
}: {
  facts: ArchitectureFacts;
  open: boolean;
  onClose: () => void;
  /** The part chosen when it opens: the AI's, or the server (from the tour, so every connection shows). */
  startPart?: PartId;
}) {
  const [tab, setTab] = useState(0);
  const [part, setPart] = useState<PartId>(startPart);
  const [table, setTable] = useState<string | null>(null);
  const [step, setStep] = useState(1);
  const [playing, setPlaying] = useState(false);
  // Each tab's own height. Every tab gets the tallest one, so switching tabs never resizes the window.
  const [heights, setHeights] = useState<Record<string, number>>({});
  const measure = (key: string) => (el: HTMLDivElement | null) => {
    if (!el) return;
    const observer = new ResizeObserver(() => setHeights((h) => (h[key] === el.offsetHeight ? h : { ...h, [key]: el.offsetHeight })));
    observer.observe(el);
    return () => observer.disconnect();
  };
  const panelsHeight = { "--panels-h": `${Math.max(0, ...Object.values(heights))}px` } as CSSProperties;

  // "Play" walks through the steps on its own, for a demo or a video.
  useEffect(() => {
    if (!playing || step >= STATION_COUNT - 1) return;
    const id = setTimeout(() => {
      setStep(step + 1);
      if (step + 1 >= STATION_COUNT - 1) setPlaying(false);
    }, 2200);
    return () => clearTimeout(id);
  }, [playing, step]);

  const close = () => {
    setPlaying(false);
    onClose();
  };
  const tester = firstName(facts.journey.tester);

  return (
    <Dialog open={open} onClose={close} className="relative z-50">
      <DialogBackdrop transition className="fixed inset-0 bg-slate-900/45 transition-opacity duration-150 data-closed:opacity-0" />
      <div className="fixed inset-0 flex items-center justify-center sm:p-6">
        <DialogPanel
          transition
          className="h-dvh w-full max-w-[68rem] overflow-y-auto bg-white p-4 shadow-xl transition duration-150 data-closed:opacity-0 sm:h-auto sm:max-h-[calc(100dvh-3rem)] sm:rounded-xl sm:border sm:border-slate-200 sm:px-6 sm:pt-4 sm:pb-5"
        >
          <TabGroup
            selectedIndex={tab}
            onChange={(i) => {
              setPlaying(false);
              setTab(i);
            }}
          >
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
              <DialogTitle className="text-lg font-semibold text-slate-900">How it&apos;s built</DialogTitle>
              <TabList className="flex gap-1 rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-sm">
                {["The parts", "Follow one report", "Why trust it"].map((label) => (
                  <Tab
                    key={label}
                    className="rounded-md px-3 py-1 text-slate-600 outline-none hover:text-slate-900 data-focus:outline-2 data-focus:outline-accent data-selected:bg-white data-selected:font-semibold data-selected:text-slate-900 data-selected:shadow-[0_1px_2px_rgba(15,23,42,.08),0_0_0_1px_#e2e8f0]"
                  >
                    <SteadyLabel weight="font-semibold">{label}</SteadyLabel>
                  </Tab>
                ))}
              </TabList>
              <button
                type="button"
                onClick={close}
                className="ml-auto rounded-md border border-slate-300 px-2.5 py-1 text-sm text-slate-800 hover:bg-slate-50"
              >
                Close
              </button>
            </div>
            <TabPanels className="mt-1 sm:min-h-(--panels-h)" style={panelsHeight}>
              <TabPanel>
                <div ref={measure("parts")}>
                  <p className="text-meta text-slate-500">Click any part.</p>
                  <Parts
                    facts={facts}
                    part={part}
                    table={table}
                    onPart={(p) => {
                      setPart(p);
                      setTable(null);
                    }}
                    onTable={(t) => {
                      setPart("data");
                      setTable(t);
                    }}
                  />
                </div>
              </TabPanel>
              <TabPanel>
                <div ref={measure("journey")}>
                  <p className="text-meta text-slate-500">
                    One sample report, from {tester}&apos;s words to a fix. Press play, or click a step.
                  </p>
                  <Journey
                    facts={facts}
                    step={step}
                    playing={playing}
                    onStep={(i) => {
                      setPlaying(false);
                      setStep(i);
                    }}
                    onPlay={() => {
                      if (playing) return setPlaying(false);
                      if (step >= STATION_COUNT - 1) setStep(0);
                      setPlaying(true);
                    }}
                  />
                </div>
              </TabPanel>
              <TabPanel>
                <div ref={measure("trust")}>
                  <p className="text-meta text-slate-500">How far to trust a suggestion, measured.</p>
                  <Trust facts={facts} onLeave={close} />
                </div>
              </TabPanel>
            </TabPanels>
          </TabGroup>
        </DialogPanel>
      </div>
    </Dialog>
  );
}

/* ======================================== The parts ======================================== */

type PartId = "people" | "server" | "ai" | "data" | "guard";

/** What the card beside the drawing shows for a part: one sentence, the technical names as chips, and "More detail". */
type Part = { title: string; icon: IconName; one: string; chips: string[]; more: string[] };

/**
 * The card for every part. The run count, the model id chip and the spend limits come from the facts; the rest is
 * written here.
 */
function partsOf(f: ArchitectureFacts): Record<PartId, Part> {
  const money = (n: number) => `$${n}`;
  return {
    people: {
      title: "People",
      icon: "person",
      one: "Testers report what went wrong. A manager decides what each report becomes. A developer fixes the tickets.",
      chips: ["Next.js 16", "React 19", "Tailwind CSS 4", "Headless UI"],
      more: [
        "Seven pages: Overview, New report, Review, Tickets, one ticket, Import, Insights.",
        "Pages are built on the server, so they open with the data already in them.",
      ],
    },
    server: {
      title: "Server",
      icon: "window",
      one: "Every click goes through here. Keys and passwords never reach the browser.",
      chips: ["Next.js server actions", "Vercel · Paris"],
      more: [
        "Imports are analysed one row per call, so the import screen can show progress.",
        "A daily Vercel cron keeps the free database awake.",
      ],
    },
    ai: {
      title: "Claude Opus 5.5",
      icon: "runs",
      one: `Reads each report ${f.samples} times, on its own each time. The more the runs agree, the surer it is.`,
      chips: [f.model, "Anthropic SDK", "Zod schema", "prompt caching"],
      more: [
        "It reads the app's rules, every test step and its expected result, the tickets, and the reports still waiting.",
        "How sure: half from how many runs agree, half from their own estimate; never above 50% if it would act on a report too thin to act on.",
        "The fixed part of the prompt is cached: 5 to 16 cents a report, less when reports arrive close together.",
        "A quicker single check runs on the report form and asks one question if a key detail is missing.",
      ],
    },
    data: {
      title: "Database",
      icon: "db",
      one: "Every report, AI answer and decision is kept, with who did what and when.",
      chips: ["Supabase", "Postgres", "row-level security"],
      more: [
        "Only the server can read or write: no table is open to the public.",
        "The AI's suggestion and the person's decision are kept side by side.",
      ],
    },
    guard: {
      title: "Guard rails",
      icon: "shield",
      one: "Nothing changes until a person approves it. AI spending has hard limits.",
      chips: [
        "ai_usage ledger",
        `${money(f.budgets.dayUsd)} a day`,
        `${money(f.budgets.totalUsd)} in all`,
        `${money(f.budgets.visitorHourUsd)} per visitor an hour`,
      ],
      more: [
        "A report is analysed when it arrives, and again if its tester answers a question. Each try stops after 90 seconds; at most two retries.",
        "A visitor is a short hash of the IP address; the address itself is never stored.",
        "The shared demo starts over after an hour without use.",
      ],
    },
  };
}

/** The first tab: the drawing beside the chosen part's card. Both layouts are drawn; CSS shows one by screen width. */
function Parts({
  facts,
  part,
  table,
  onPart,
  onTable,
}: {
  facts: ArchitectureFacts;
  part: PartId;
  table: string | null;
  onPart: (p: PartId) => void;
  onTable: (t: string) => void;
}) {
  const parts = partsOf(facts);
  const p = parts[part];
  const drawing = { facts, part, table, onPart, onTable };
  return (
    // On a wide screen the card takes its height from the drawing and scrolls inside, so the window never resizes.
    <div className="mt-3 grid gap-4 lg:grid-cols-[minmax(0,1fr)_17.5rem]">
      <div data-tour="parts" className="overflow-hidden rounded-lg border border-slate-200">
        <Drawing {...drawing} geometry={WIDE} className="hidden sm:block" />
        <Drawing {...drawing} geometry={NARROW} className="sm:hidden" />
      </div>
      <div className="relative rounded-lg border border-slate-200">
        <div className="flex flex-col p-4 lg:absolute lg:inset-0 lg:overflow-y-auto" aria-live="polite">
          <div className="flex items-center gap-2.5">
            <Icon name={p.icon} className="h-7 w-7 text-accent" />
            <h3 className="font-semibold text-slate-900">{p.title}</h3>
          </div>
          <p className="mt-2.5 text-[0.9375rem] leading-6 text-slate-700">{p.one}</p>
          <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Built with">
            {p.chips.map((c) => (
              <li key={c} className="rounded border border-slate-200 px-1.5 font-mono text-xs leading-5 text-slate-800">
                {c}
              </li>
            ))}
          </ul>
          {part === "data" && (
            <p className="mt-3 text-meta text-slate-700">
              {table ? (
                <>
                  <span className="font-mono text-accent">{table}</span>: {TABLE_NOTE[table]}
                </>
              ) : (
                <span className="text-slate-500">Click a table name in the drawing.</span>
              )}
            </p>
          )}
          <details className="group mt-auto pt-4 text-meta text-slate-700">
            <summary className="cursor-pointer list-none font-medium text-accent hover:underline [&::-webkit-details-marker]:hidden">
              More detail<span aria-hidden className="group-open:hidden"> ›</span>
            </summary>
            <ul className="mt-2 list-disc space-y-1.5 pl-4 marker:text-slate-400">
              {p.more.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          </details>
        </div>
      </div>
    </div>
  );
}

/* The drawing: one set of positions for a wide window, one stacked for a phone. Units are the SVG's own. */

type Box = [x: number, y: number, w: number, h: number];
type Pt = [number, number];
/** Where a label sits. Text centres it on x unless an anchor is given (SVG's own default would be "start"). */
type Txt = [x: number, y: number, anchor?: "start" | "middle" | "end"];
/**
 * Where everything sits in one layout. An icon is [x, y, size]; an arrow's label is [text, x, y, anchor]. An arrow
 * lights up when one of its parts is chosen; on a phone, one with no return path gets a head at each end.
 */
type Geometry = {
  view: [number, number];
  people: { box: Box; title: Txt; icons: { x: number; y: number }[]; size: number; labelY: number; tag: Txt };
  server: { box: Box; icon: [number, number, number]; title: Txt; tag: Txt };
  ai: { box: Box; icon: [number, number, number]; times: Txt; title: Txt; tag: Txt };
  arrows: { to: Pt[]; back?: Pt[]; label: [string, ...Txt]; label2?: [string, ...Txt]; part: PartId[] }[];
  db: { box: Box; icon: [number, number, number]; title: Txt; tag: Txt; groups: { x: number; y: number }[] };
  guard: { box: Box; title: Txt; badges: { x: number; y: number }[]; size: number };
};

const PEOPLE = ["Tester", "Manager", "Developer"];
/** Each person drawn with their role icon, or as a plain figure when the role icons are off. */
const PEOPLE_ICON: IconName[] = ROLE_ICONS ? ["tester", "manager", "developer"] : ["person", "person", "person"];

const WIDE: Geometry = {
  view: [800, 440],
  people: {
    box: [14, 16, 210, 140],
    title: [119, 44],
    icons: [{ x: 50, y: 60 }, { x: 119, y: 60 }, { x: 188, y: 60 }],
    size: 32,
    labelY: 116,
    tag: [119, 142],
  },
  server: { box: [300, 16, 190, 140], icon: [375, 34, 40], title: [395, 104], tag: [395, 128] },
  ai: { box: [580, 16, 206, 140], icon: [640, 32, 46], times: [718, 72], title: [683, 108], tag: [683, 132] },
  arrows: [
    { to: [[230, 66], [294, 66]], back: [[294, 104], [230, 104]], label: ["report", 262, 56], label2: ["suggestion", 262, 122], part: ["people", "server"] },
    { to: [[496, 66], [574, 66]], back: [[574, 104], [496, 104]], label: ["report", 535, 56], label2: ["answer", 535, 122], part: ["ai", "server"] },
    { to: [[395, 162], [395, 212]], back: [[410, 212], [410, 162]], label: ["saves, reads", 422, 192, "start"], part: ["data", "server"] },
  ],
  db: {
    box: [14, 220, 772, 120],
    icon: [34, 240, 40],
    title: [84, 254, "start"],
    tag: [84, 276, "start"],
    groups: [{ x: 250, y: 246 }, { x: 360, y: 246 }, { x: 470, y: 246 }, { x: 580, y: 246 }, { x: 680, y: 246 }],
  },
  guard: { box: [14, 362, 772, 64], title: [34, 400, "start"], badges: [{ x: 200, y: 380 }, { x: 400, y: 380 }, { x: 590, y: 380 }], size: 28 },
};

const NARROW: Geometry = {
  view: [340, 738],
  people: {
    box: [10, 10, 320, 122],
    title: [170, 34],
    icons: [{ x: 58, y: 46 }, { x: 156, y: 46 }, { x: 254, y: 46 }],
    size: 28,
    labelY: 94,
    tag: [170, 116],
  },
  server: { box: [10, 174, 290, 76], icon: [26, 191, 34], title: [74, 207, "start"], tag: [74, 229, "start"] },
  ai: { box: [10, 292, 290, 78], icon: [24, 307, 38], times: [68, 336, "start"], title: [106, 323, "start"], tag: [106, 346, "start"] },
  arrows: [
    { to: [[150, 138], [150, 168]], back: [[190, 168], [190, 138]], label: ["report", 142, 157, "end"], label2: ["suggestion", 198, 157, "start"], part: ["people", "server"] },
    { to: [[130, 256], [130, 286]], back: [[170, 286], [170, 256]], label: ["report", 122, 275, "end"], label2: ["answer", 178, 275, "start"], part: ["ai", "server"] },
    { to: [[306, 212], [322, 212], [322, 392]], label: ["saves, reads", 314, 386, "end"], part: ["data", "server"] },
  ],
  db: {
    box: [10, 398, 320, 182],
    icon: [24, 412, 32],
    title: [66, 428, "start"],
    tag: [66, 448, "start"],
    groups: [{ x: 24, y: 476 }, { x: 128, y: 476 }, { x: 128, y: 532 }, { x: 228, y: 476 }, { x: 228, y: 517 }],
  },
  guard: { box: [10, 594, 320, 134], title: [24, 620, "start"], badges: [{ x: 24, y: 634 }, { x: 24, y: 664 }, { x: 24, y: 694 }], size: 22 },
};

/**
 * The drawing's colours: INK for icons, LINE and ARROW for boxes and arrows at rest, SUB for small labels.
 * ACCENT and SOFT are --color-accent and --color-accent-soft from globals.css; change them together.
 */
const INK = "#334155";
const LINE = "#cbd5e1";
const ARROW = "#94a3b8";
const ACCENT = "#0000c9";
const SOFT = "#e8f2ff";
const SUB = "#64748b";

/** The parts as one SVG in the given layout. Each box and each table name is a Hit: it works by click and keyboard. */
function Drawing({
  facts,
  part,
  table,
  onPart,
  onTable,
  geometry: g,
  className,
}: {
  facts: ArchitectureFacts;
  part: PartId;
  table: string | null;
  onPart: (p: PartId) => void;
  onTable: (t: string) => void;
  geometry: Geometry;
  className: string;
}) {
  const parts = partsOf(facts);
  const narrow = g === NARROW;
  const label = (id: PartId) => parts[id].title;
  return (
    <svg viewBox={`0 0 ${g.view[0]} ${g.view[1]}`} className={`w-full font-sans ${className}`} role="group" aria-label="The parts of the app">
      <Hit id="people" label={label("people")} on={part === "people"} onSelect={onPart}>
        <Frame box={g.people.box} on={part === "people"} />
        <Text at={g.people.title} size={15} weight={600}>People</Text>
        {g.people.icons.map((p, i) => (
          <g key={PEOPLE[i]}>
            <Glyph name={PEOPLE_ICON[i]} x={p.x - g.people.size / 2} y={p.y} size={g.people.size} />
            <Text at={[p.x, g.people.labelY]} size={12.5} fill={SUB}>{PEOPLE[i]}</Text>
          </g>
        ))}
        <Text at={g.people.tag} size={11.5} fill={SUB} mono>Next.js · React</Text>
      </Hit>

      <Hit id="server" label={label("server")} on={part === "server"} onSelect={onPart}>
        <Frame box={g.server.box} on={part === "server"} />
        <Glyph name="window" x={g.server.icon[0]} y={g.server.icon[1]} size={g.server.icon[2]} />
        <Text at={g.server.title} size={15} weight={600}>Server</Text>
        <Text at={g.server.tag} size={11.5} fill={SUB} mono>Next.js · Vercel</Text>
      </Hit>

      <Hit id="ai" label={label("ai")} on={part === "ai"} onSelect={onPart}>
        <Frame box={g.ai.box} on={part === "ai"} />
        <Glyph name="runs" x={g.ai.icon[0]} y={g.ai.icon[1]} size={g.ai.icon[2]} />
        <Text at={g.ai.times} size={narrow ? 18 : 22} weight={700}>{`×${facts.samples}`}</Text>
        <Text at={g.ai.title} size={15} weight={600}>Claude Opus 5.5</Text>
        <Text at={g.ai.tag} size={11.5} fill={SUB} mono>{`${facts.samples} runs per report`}</Text>
      </Hit>

      {g.arrows.map((a) => {
        const on = a.part.includes(part);
        return (
          <g key={a.label[0] + a.label[1]} aria-hidden>
            <Arrow points={a.to} on={on} both={!a.back && narrow} />
            {a.back && <Arrow points={a.back} on={on} />}
            <Text at={[a.label[1], a.label[2], a.label[3]]} size={12} fill={SUB}>{a.label[0]}</Text>
            {a.label2 && <Text at={[a.label2[1], a.label2[2], a.label2[3]]} size={12} fill={SUB}>{a.label2[0]}</Text>}
          </g>
        );
      })}

      <Hit id="data" label={label("data")} on={part === "data"} onSelect={onPart}>
        <Frame box={g.db.box} on={part === "data"} />
        <Glyph name="db" x={g.db.icon[0]} y={g.db.icon[1]} size={g.db.icon[2]} />
        <Text at={g.db.title} size={15} weight={600}>Database</Text>
        <Text at={g.db.tag} size={11.5} fill={SUB} mono>{`Supabase · ${TABLE_GROUPS.flatMap((x) => x.tables).length} tables`}</Text>
      </Hit>
      {TABLE_GROUPS.map((group, i) => {
        const at = g.db.groups[i];
        return (
          <g key={group.name}>
            <Text at={[at.x, at.y, "start"]} size={12} weight={600}>{group.name}</Text>
            {group.tables.map((t, j) => (
              <Hit key={t} id={t} label={`Table ${t}`} on={table === t} onSelect={onTable}>
                <rect x={at.x - 3} y={at.y + 7 + j * 15} width={narrow ? 92 : 100} height={15} rx={3} fill={table === t ? SOFT : "transparent"} />
                <rect className="opacity-0 group-focus-visible:opacity-100" x={at.x - 4} y={at.y + 6 + j * 15} width={narrow ? 94 : 102} height={17} rx={3} fill="none" stroke={ACCENT} strokeWidth={1.5} />
                <text x={at.x} y={at.y + 18 + j * 15} className="font-mono group-hover:underline" fontSize={10.5} fill={table === t ? ACCENT : SUB}>
                  {t}
                </text>
              </Hit>
            ))}
          </g>
        );
      })}

      <Hit id="guard" label={label("guard")} on={part === "guard"} onSelect={onPart}>
        <Frame box={g.guard.box} on={part === "guard"} />
        <Text at={g.guard.title} size={15} weight={600}>Guard rails</Text>
        {(
          [
            ["shield", "A person approves"],
            ["coin", "AI spend capped"],
            ["lock", "Keys stay on the server"],
          ] as const
        ).map(([icon, text], i) => {
          const b = g.guard.badges[i];
          return (
            <g key={icon}>
              <Glyph name={icon} x={b.x} y={b.y} size={g.guard.size} />
              <Text at={[b.x + g.guard.size + 10, b.y + g.guard.size * 0.68, "start"]} size={13.5}>{text}</Text>
            </g>
          );
        })}
      </Hit>
    </svg>
  );
}

/** A clickable part of the drawing, reachable with Tab and opened with Enter or Space. */
function Hit<T extends string>({ id, label, on, onSelect, children }: { id: T; label: string; on: boolean; onSelect: (id: T) => void; children: ReactNode }) {
  const keyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect(id);
    }
  };
  return (
    <g role="button" tabIndex={0} aria-label={label} aria-pressed={on} onClick={() => onSelect(id)} onKeyDown={keyDown} className="group cursor-pointer outline-none">
      {children}
    </g>
  );
}

/** A part's box. Chosen: an accent outline with a soft halo. A dashed ring shows only on keyboard focus. */
function Frame({ box: [x, y, w, h], on }: { box: Box; on: boolean }) {
  return (
    <>
      {on && <rect x={x - 3.5} y={y - 3.5} width={w + 7} height={h + 7} rx={13} fill="none" stroke={SOFT} strokeWidth={5} />}
      <rect x={x} y={y} width={w} height={h} rx={10} fill="#fff" stroke={on ? ACCENT : LINE} strokeWidth={on ? 1.75 : 1} className={on ? "" : "transition-colors group-hover:stroke-slate-400"} />
      <rect className="opacity-0 group-focus-visible:opacity-100" x={x - 5} y={y - 5} width={w + 10} height={h + 10} rx={14} fill="none" stroke={ACCENT} strokeWidth={2} strokeDasharray="3 3" />
    </>
  );
}

function Text({ at: [x, y, anchor = "middle"], size, weight = 400, fill = "#0f172a", mono, children }: { at: Txt; size: number; weight?: number; fill?: string; mono?: boolean; children: string }) {
  return (
    <text x={x} y={y} fontSize={size} fontWeight={weight} fill={fill} textAnchor={anchor} className={mono ? "font-mono" : undefined}>
      {children}
    </text>
  );
}

/** A line through the points with a head at the last one, and at the first too when both is set. Accent when on. */
function Arrow({ points, on, both }: { points: Pt[]; on: boolean; both?: boolean }) {
  const head = (from: Pt, to: Pt) => {
    const a = Math.atan2(to[1] - from[1], to[0] - from[0]);
    const p = (d: number) => `${to[0] - 7 * Math.cos(a + d)} ${to[1] - 7 * Math.sin(a + d)}`;
    return `M ${p(-0.45)} L ${to[0]} ${to[1]} L ${p(0.45)}`;
  };
  const n = points.length;
  return (
    <g stroke={on ? ACCENT : ARROW} strokeWidth={on ? 1.8 : 1.3} fill="none" strokeLinecap="round" strokeLinejoin="round">
      <path d={`M ${points.map((p) => p.join(" ")).join(" L ")}`} />
      <path d={head(points[n - 2], points[n - 1])} />
      {both && <path d={head(points[1], points[0])} />}
    </g>
  );
}

/** An icon placed inside the drawing at x, y and size; its lines keep the same width however far it is scaled. */
function Glyph({ name, x, y, size }: { name: IconName; x: number; y: number; size: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${size / 24})`} fill="none" stroke={INK} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="[&_*]:[vector-effect:non-scaling-stroke]">
      {ICONS[name]}
    </g>
  );
}

/* ======================================== One report ======================================== */

type StationState = "done" | "now" | "next";
/** One step of the journey: its circle and title on the line, and below, its body and the table it is saved in. */
type Station = { icon: IconName; title: string; sub: string; state: StationState; table: string; note: string; body: ReactNode };

/** How many steps stationsOf returns: Play stops at the last. Journey's sm:grid-cols-6 assumes the same number. */
const STATION_COUNT = 6;
const STATE_TEXT: Record<StationState, string> = { done: "Saved", now: "Waiting in Review now", next: "After a manager approves it" };

/**
 * The six steps of the sample report: two done, the decision waiting in Review, three that follow approval.
 * Built from the sample files, not the live demo, so it reads the same after someone decides that report.
 */
function stationsOf(f: ArchitectureFacts): Station[] {
  const j = f.journey;
  const tester = firstName(j.tester), manager = firstName(j.manager), developer = firstName(j.developer);
  const day = new Date(j.submittedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  const percent = Math.round(j.confidence * 100);
  const [before, after] = j.reply.split("{ticket}");
  return [
    {
      icon: "bubble",
      title: `${tester} reports`,
      sub: `${day} · ${j.step}`,
      state: "done",
      table: "feedback",
      note: j.ref,
      body: (
        <>
          <p className="max-w-2xl rounded-2xl rounded-bl-sm bg-slate-100 px-3.5 py-2.5 text-[0.9375rem] leading-6 text-slate-900">“{j.text}”</p>
          <p className="mt-1.5 text-meta text-slate-500">
            {j.tester}, tester{j.result === "fail" ? " · step marked failed" : ""}
          </p>
        </>
      ),
    },
    {
      icon: "runs",
      title: `Claude reads it ×${j.runs.length}`,
      sub: `${(j.latencyMs / 1000).toFixed(1)} s${j.costUsd === null ? "" : ` · $${j.costUsd.toFixed(2)}`}`,
      state: "done",
      table: "analyses",
      note: `${j.runs.length} runs`,
      body: (
        <>
          <div className="flex flex-wrap items-center gap-2.5">
            {j.runs.map((r, i) => (
              <div key={i} className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-center text-meta text-slate-700">
                {ACTION_LABEL[r.action]}
                <b className="block text-[0.9375rem] font-semibold text-slate-900 tabular-nums">{r.self}%</b>
              </div>
            ))}
            <span aria-hidden className="text-lg text-slate-400">→</span>
            <div>
              <div className="text-[2rem] leading-9 font-semibold text-accent tabular-nums">{percent}%</div>
              <div className="text-xs text-slate-500">
                {j.agreeing} of {j.runs.length} agree
              </div>
            </div>
          </div>
          <p className="mt-2.5 max-w-3xl text-meta text-slate-600">
            {j.nearMiss && j.agreeing === j.runs.length && j.action === "create_ticket"
              ? `${j.nearMiss} looked close. All ${j.runs.length} runs saw a different fault.`
              : `Why: ${j.why}`}
          </p>
        </>
      ),
    },
    {
      icon: "decide",
      title: `${manager} decides`,
      sub: "waiting now",
      state: "now",
      table: "decisions",
      note: "1 row",
      body: (
        <>
          <div className="inline-flex items-center gap-3 rounded-lg border border-slate-200 px-3 py-2.5">
            <div>
              <div className="text-xs text-slate-500">Suggested</div>
              <div className="font-semibold text-slate-900">{ACTION_LABEL[j.action]}</div>
            </div>
            <span className="rounded-md bg-white px-2.5 py-1 text-sm font-medium text-accent-fill inset-ring-[1.5px] inset-ring-accent">Approve</span>
            <span className="text-sm text-slate-500">or another outcome</span>
          </div>
          <p className="mt-2.5 text-meta text-slate-600">One report at a time. No “approve all”.</p>
        </>
      ),
    },
    {
      icon: "ticket",
      title: "Ticket opened",
      sub: "drafted by Claude",
      state: "next",
      table: "tickets",
      note: "1 row",
      body: j.draft && (
        <>
          <div className="inline-block max-w-xl rounded-lg border border-l-[3px] border-slate-200 border-l-accent px-3.5 py-2.5">
            <div className="text-meta text-slate-500">New ticket · bug{j.draft.severity ? ` · ${j.draft.severity}` : ""}</div>
            <div className="mt-0.5 font-semibold text-slate-900">{j.draft.title}</div>
          </div>
          <p className="mt-2.5 text-meta text-slate-600">
            With steps, expected and actual; {manager} can edit it first.
            {j.followers.length > 0 &&
              ` ${list(j.followers)} ${j.followers.length === 1 ? "describes the same bug and joins" : "describe the same bug and join"} it next.`}
          </p>
        </>
      ),
    },
    {
      icon: "mail",
      title: `${tester} hears back`,
      sub: "on the tester's page",
      state: "next",
      table: "feedback",
      note: "tester_message",
      body: (
        <>
          <p className="max-w-2xl rounded-2xl rounded-br-sm bg-accent-soft px-3.5 py-2.5 text-[0.9375rem] leading-6 text-slate-900">
            {before}
            {after !== undefined && (
              <>
                <span className="rounded border border-dashed border-accent/50 px-1 text-accent">ticket number</span>
                {after}
              </>
            )}
          </p>
          <p className="mt-1.5 text-meta text-slate-500">Sent when {manager} approves; the number is filled in then.</p>
        </>
      ),
    },
    {
      icon: "wrench",
      title: "Fixed, retested",
      sub: `${developer}, then ${tester}`,
      state: "next",
      table: "ticket_events",
      note: "a row each",
      body: (
        <>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="rounded-full border border-slate-200 px-3 py-1">{developer} picks it up</span>
            <span aria-hidden className="text-slate-400">→</span>
            <span className="rounded-full border border-slate-200 px-3 py-1">{developer} marks it fixed</span>
            <span aria-hidden className="text-slate-400">→</span>
            <span className="rounded-full border border-green-300 bg-green-50 px-3 py-1 text-green-800">{tester}: works now</span>
          </div>
          <p className="mt-2.5 text-meta text-slate-600">Still broken? {developer} sees it and reopens. Nothing closes by itself.</p>
        </>
      ),
    },
  ];
}

/** Joins refs for a sentence: "A", "A and B", "A, B and C"; "" when there are none. */
function list(items: string[]): string {
  return items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

const CIRCLE: Record<StationState, string> = {
  done: "border-slate-700 text-slate-700",
  now: "border-amber-600 text-amber-700",
  next: "border-dashed border-slate-300 text-slate-400",
};

/** The second tab: the steps in a row (a column on a phone), Play, and the chosen step's detail below. */
function Journey({
  facts,
  step,
  playing,
  onStep,
  onPlay,
}: {
  facts: ArchitectureFacts;
  step: number;
  playing: boolean;
  onStep: (i: number) => void;
  onPlay: () => void;
}) {
  const stations = stationsOf(facts);
  const s = stations[step];
  return (
    <div className="mt-3">
      <div className="rounded-lg border border-slate-200 px-3 pt-4 pb-2 sm:px-2">
        <ol className="relative grid gap-y-2 sm:grid-cols-6" aria-label="Steps">
          {stations.map((st, i) => {
            const nextDone = stations[i + 1]?.state === "done";
            return (
              <li key={st.title} className="relative">
                {i < stations.length - 1 && (
                  <>
                    <span aria-hidden className={`absolute top-8 right-[calc(-50%+2rem)] left-[calc(50%+2rem)] hidden border-t sm:block ${nextDone ? "border-slate-500" : "border-dashed border-slate-300"}`} />
                    <span aria-hidden className={`absolute top-[3.75rem] left-8 h-4 border-l sm:hidden ${nextDone ? "border-slate-500" : "border-dashed border-slate-300"}`} />
                  </>
                )}
                <button
                  type="button"
                  onClick={() => onStep(i)}
                  aria-current={i === step ? "step" : undefined}
                  className="flex w-full items-center gap-3 rounded-lg p-1 text-left outline-none focus-visible:bg-slate-50 sm:flex-col sm:gap-1.5 sm:text-center"
                >
                  <span className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-full border-[1.5px] bg-white transition-[outline-color] ${CIRCLE[st.state]} ${i === step ? "outline-[1.5px] outline-offset-4 outline-accent outline-solid" : "outline-transparent"}`}>
                    <Icon name={st.icon} className="h-7 w-7" />
                  </span>
                  <span>
                    <span className={`block text-sm font-semibold ${st.state === "next" ? "text-slate-500" : "text-slate-900"}`}>{st.title}</span>
                    <span className={`block text-xs ${st.state === "now" ? "text-amber-800" : "text-slate-500"}`}>{st.sub}</span>
                  </span>
                </button>
              </li>
            );
          })}
          <span
            aria-hidden
            className="pointer-events-none absolute top-0 hidden h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent-fill transition-[left] duration-700 ease-in-out motion-reduce:transition-none sm:block"
            style={{ left: `${((step + 0.5) / stations.length) * 100}%` }}
          />
        </ol>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={onPlay}
          className={`rounded-md border px-3 py-1 text-sm font-medium ${playing ? "border-accent bg-white text-accent" : "border-accent bg-white text-accent-fill inset-ring inset-ring-accent hover:bg-accent-soft"}`}
        >
          {playing ? "Stop" : "▶ Play"}
        </button>
        <span className={`text-meta ${s.state === "now" ? "text-amber-800" : "text-slate-500"}`} aria-live="polite">
          {step + 1} of {stations.length} · {STATE_TEXT[s.state]}
        </span>
      </div>
      {/* One height for every step, so nothing below moves while it plays. */}
      <div className="mt-3 grid gap-3 rounded-lg border border-slate-200 p-4 sm:h-40 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-5">
        <div>{s.body}</div>
        <p className="font-mono text-xs leading-5 text-slate-500 sm:text-right">
          saved in <span className="text-slate-800">{s.table}</span>
          <br />
          {s.note}
        </p>
      </div>
    </div>
  );
}

/* ======================================== Why trust it ======================================== */

/** One dot per labelled report: filled when the AI was right, hollow when it was not. */
function Dots({ n, correct }: { n: number; correct: number }) {
  return (
    <div aria-hidden className="mt-2 flex flex-wrap gap-[3px]">
      {Array.from({ length: n }, (_, i) => (
        <span key={i} className={`h-2 w-2 rounded-full ${i < correct ? "bg-accent-fill" : "border border-slate-400 bg-white"}`} />
      ))}
    </div>
  );
}

/**
 * The third tab. The figures are real: the sample report's confidence and agreeing runs, the measured and held-out
 * results. The rest is fixed example text. onLeave closes the window as the link opens Insights.
 */
function Trust({ facts, onLeave }: { facts: ArchitectureFacts; onLeave: () => void }) {
  const { measured, holdout } = facts.trust;
  const { runs, agreeing, confidence } = facts.journey;
  const card = "flex flex-col rounded-lg border border-slate-200 p-4";
  const head = (icon: IconName, title: string) => (
    <div className="flex items-center gap-2.5">
      <Icon name={icon} className="h-6 w-6 text-accent" />
      <h3 className="font-semibold text-slate-900">{title}</h3>
    </div>
  );
  return (
    <div className="mt-3 grid gap-4 sm:grid-cols-3">
      <div className={card}>
        {head("reasons", "Shows its reasons")}
        <div className="mt-3 rounded-lg border border-slate-200 px-3 py-2.5 text-meta">
          <p className="text-xs font-semibold text-slate-500">Why flagged</p>
          <p className="mt-1 text-slate-700">✓ Facts first: same test step or script</p>
          <p className="text-slate-700">✓ Then what the AI read in the words</p>
          <div className="mt-2 flex items-center gap-2">
            <span className="h-1.5 flex-1 rounded-full bg-slate-100">
              <span className="block h-1.5 rounded-full bg-accent-fill" style={{ width: `${Math.round(confidence * 100)}%` }} />
            </span>
            <span className="text-xs text-slate-600 tabular-nums">
              {agreeing} of {runs.length} runs agree
            </span>
          </div>
        </div>
        <p className="mt-3 text-meta text-slate-600">Every suggestion says why, and how sure it is.</p>
      </div>

      <div className={card}>
        {head("target", "Measured, not guessed")}
        <p className="mt-3">
          <span className="text-3xl font-semibold text-slate-900 tabular-nums">
            {measured.correct} of {measured.n}
          </span>{" "}
          <span className="text-sm text-slate-600">right on our samples</span>
        </p>
        <Dots n={measured.n} correct={measured.correct} />
        <p className="mt-3">
          <span className="text-3xl font-semibold text-slate-900 tabular-nums">
            {holdout.correct} of {holdout.n}
          </span>{" "}
          <span className="text-sm text-slate-600">on unseen reports</span>
        </p>
        <Dots n={holdout.n} correct={holdout.correct} />
        <p className="mt-3 text-meta text-slate-600">
          The {measured.n} also tuned the AI; the {holdout.n}, written by a separate AI agent, never did. Not yet tested on real data.
        </p>
      </div>

      <div className={card}>
        {head("decide", "No “approve all”")}
        <div className="mt-3 rounded-lg border border-slate-200 px-3 py-2.5 text-meta">
          <p className="text-xs text-slate-500">Report 2 of 10</p>
          <div className="mt-1.5 flex items-center gap-2">
            <span className="rounded-md bg-white px-2.5 py-1 text-sm font-medium text-accent-fill inset-ring-[1.5px] inset-ring-accent">Approve</span>
            <span className="text-sm text-slate-500">or another outcome</span>
          </div>
        </div>
        <p className="mt-3 text-meta text-slate-600">
          A person decides each report. The AI changes nothing by itself; every change is recorded.
        </p>
        <Link href="/insights" onClick={onLeave} className="mt-auto pt-3 text-meta font-medium text-accent hover:underline">
          See how sure is sure
          <LinkArrow />
        </Link>
      </div>
    </div>
  );
}

/* ======================================== Icons ======================================== */

type IconName =
  | "person" | "window" | "runs" | "db" | "shield" | "coin" | "lock" | "bubble" | "decide" | "ticket" | "mail" | "wrench"
  | "reasons" | "target" | "tester" | "manager" | "developer";

/** 24×24 line drawings. "runs" is three cards stacked: one per AI run. */
const ICONS: Record<IconName, ReactNode> = {
  person: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4.5 21c.6-4 3.6-7 7.5-7s6.9 3 7.5 7" />
    </>
  ),
  window: (
    <>
      <rect x="2.5" y="4" width="19" height="16" rx="2" />
      <path d="M2.5 9h19M6 6.5h.5M9 6.5h.5M7 13h10M7 16.5h6" />
    </>
  ),
  runs: ROLE_PATHS.ai,
  tester: ROLE_PATHS.tester,
  manager: ROLE_PATHS.manager,
  developer: ROLE_PATHS.developer,
  db: (
    <>
      <ellipse cx="12" cy="5.5" rx="8" ry="3" />
      <path d="M4 5.5v13c0 1.7 3.6 3 8 3s8-1.3 8-3v-13M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" />
    </>
  ),
  shield: (
    <>
      <path d="M12 2.8l8 3v6.2c0 4.6-3.4 8.4-8 9.2-4.6-.8-8-4.6-8-9.2V5.8z" />
      <path d="M8.3 12.2l2.6 2.6 4.8-5.2" />
    </>
  ),
  coin: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M15.2 9.3c-.5-.9-1.7-1.5-3.2-1.5-1.8 0-3.1.9-3.1 2.1s1.3 1.8 3.1 2.1 3.1.9 3.1 2.1-1.3 2.1-3.1 2.1c-1.5 0-2.7-.6-3.2-1.5M12 6v12" />
    </>
  ),
  lock: (
    <>
      <rect x="4.5" y="10.5" width="15" height="10.5" rx="2" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3M12 14.5v2.5" />
    </>
  ),
  bubble: (
    <>
      <path d="M4 4.5h16a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5H10l-5 4v-4H4A1.5 1.5 0 0 1 2.5 15V6A1.5 1.5 0 0 1 4 4.5z" />
      <path d="M7 9h10M7 12h6" />
    </>
  ),
  decide: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M7.8 12.4l2.8 2.8 5.6-6" />
    </>
  ),
  ticket: (
    <>
      <path d="M2.5 7a1.5 1.5 0 0 1 1.5-1.5h16A1.5 1.5 0 0 1 21.5 7v2.5a2.5 2.5 0 0 0 0 5V17a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 17v-2.5a2.5 2.5 0 0 0 0-5z" />
      <path d="M15 5.5v13" strokeDasharray="1.6 2" />
    </>
  ),
  mail: (
    <>
      <rect x="2.5" y="5" width="19" height="14" rx="2" />
      <path d="M3 6.5l9 6.5 9-6.5" />
    </>
  ),
  reasons: (
    <>
      <path d="M10 6.5h10.5M10 12h10.5M10 17.5h10.5" />
      <path d="M3.5 6.5l1.4 1.4L7.5 5.2M3.5 12l1.4 1.4L7.5 10.7M3.5 17.5l1.4 1.4 2.6-2.7" />
    </>
  ),
  target: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1.2" />
    </>
  ),
  wrench: (
    <>
      <path d="M14.7 6.3a4.5 4.5 0 0 0 5.9 5.4l-8.7 8.7a2.3 2.3 0 0 1-3.3-3.3l8.7-8.7a4.5 4.5 0 0 1-2.6-2.1z" />
      <path d="M18.5 3.5l-2.2 2.2.4 1.9 1.9.4 2.2-2.2" />
    </>
  ),
};

/** An icon as its own SVG in the text colour, for cards and steps. Glyph draws the same icons inside the drawing. */
function Icon({ name, className }: { name: IconName; className: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className={className}>
      {ICONS[name]}
    </svg>
  );
}
