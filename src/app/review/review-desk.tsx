"use client";

import { Tip } from "@/components/ui/tip";
import { Listbox, ListboxButton, ListboxOption, ListboxOptions } from "@headlessui/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { decideAction, reanalyseAction } from "@/app/actions";
import { Agreement, Confidence, ConfidenceBar, Pill } from "@/components/badges";
import { ResetDemo } from "@/components/reset-demo";
import { AiTag } from "@/components/ui/ai-tag";
import { BoxHeader } from "@/components/ui/box-header";
import { InfoTip } from "@/components/ui/info-tip";
import { LinkArrow } from "@/components/ui/link-arrow";
import { BusyLabel } from "@/components/ui/busy-label";
import { button } from "@/components/ui/button";
import { Check, CheckCircle, ChevronDown, Cross, Lines, Speech } from "@/components/ui/icons";
import { Segmented } from "@/components/ui/segmented";
import { Select } from "@/components/ui/select";
import { Severity } from "@/components/ui/severity";
import { calibrate, calibrationInfo } from "@/lib/ai/calibration";
import { ACTIONS, type Action, type Analysis } from "@/lib/ai/schema";
import type { DecisionInput, TicketDraft } from "@/lib/decide";
import {
  ACTION_GROUPS,
  ACTION_HINT,
  ACTION_LABEL,
  BUCKET_LABEL,
  type Bucket,
  EVIDENCE_LABEL,
  SEVERITY_LABEL,
  TICKET_STATUS_LABEL,
  bucketHeadline,
  bucketLine,
  bucketOf,
  firstName,
  formatDay,
  formatWhen,
} from "@/lib/labels";
import type { QueueItem } from "@/lib/queries";
import { keyPattern, nextTicketKey } from "@/lib/ticket-key";
import type { Severity as SeverityLevel, Ticket } from "@/lib/types";

/**
 * The whole Review screen, where the UAT manager decides each report, one at a time. page.tsx loads the data; a decision
 * is saved by decideAction (decide() in src/lib/decide.ts), and nothing is created until the manager approves. There is
 * deliberately no approve-all.
 *
 * Three columns on a wide screen, each scrolling on its own: the queue on the left (To review and Waiting for tester, and
 * a menu that narrows it to one bucket), the report and the AI's suggestion in the middle, the decision on the right.
 * Below 1280 px the decision moves under the suggestion. Below 1024 px the list and the report take turns, and Approve
 * and Skip sit in a bar at the bottom of the screen. After a decision, the next report on the same problem opens.
 *
 * Keys: J and K move down and up the list; 1 to 6 choose the outcome, in the order the buttons sit; A approves. They do
 * nothing while typing in a field or an open menu, with Cmd, Ctrl or Alt held (so Cmd+A still selects text), or while
 * the guided tour runs, because the tour only shows. A and 1 to 6 ignore a held-down key, and A waits 0.9 seconds after
 * a report opens, so pressing it again and again cannot approve the queue away. Both key listeners are added again after
 * every render (no dependency list), so a key always acts on the report and the choice on screen.
 *
 * TextBox: a text area that grows with its text up to a few lines, then scrolls.
 * ReviewDesk: the queue, the open report, refreshing while the AI works, J and K, and the notice after a decision.
 * QueueRow: one report in the list: ref, day, tester, first line, and the AI's bucket with how sure it is.
 * BucketMenu: every report, or one bucket, with the counts.
 * ItemView: one report: the middle column and the decision beside it.
 * ReportCard: the tester's words, the step and what should have happened, and any question and answer.
 * StepResult: Passed or Failed, as the tester marked the step.
 * WaitingForTester: a question has gone to the tester: reply as them, or decide without waiting.
 * Analysing: the AI is still on it; after 90 seconds, a button to try again.
 * Suggestion: the AI's bucket, how sure it is and why, Why flagged, and the one-click overrules.
 * Sure: the confidence figure, amber below 85%.
 * EvidenceChip: how much the report says, in words.
 * DecisionForm: the six outcomes, what approving will create, the tester's message, Approve and Skip.
 * TicketFields: the fields of a new ticket or idea, after Edit.
 * NextSteps: what happens after approving, numbered.
 * Row: a form row with its label on the left.
 * Kbd: the key on a button.
 * Plain functions sit between them, such as alternatives (the one-click overrules) and draftFromReport (a ticket drafted
 * from the tester's own words when the AI wrote none).
 */

type TicketOption = Pick<
  Ticket,
  "id" | "key" | "title" | "summary" | "kind" | "origin" | "status" | "status_note" | "severity" | "step_id"
> & {
  reports: number;
  testers: number;
  /** The developer on it, if anyone has picked it up. */
  assignee: string | null;
  /** The first report on it, in the tester's words. */
  quotes: string[];
};

/** One of the app's rules (what is meant to be that way); a suggestion that cites one shows it under Why flagged. */
type Rule = { id: string; rule: string };

/**
 * Whether the AI matched a report rather than a ticket (refs start FB-, IMP- or TR-). The same test as isFeedbackRef in
 * src/lib/decide.ts, a server file this browser code does not import.
 */
const isFeedbackRef = (t: string | null | undefined) => !!t && /^(FB|IMP|TR)-/i.test(t);

/** Height limits in whole lines of the text's own line height, on a phone's larger type too (plus the top padding). */
const LINES = {
  2: "max-h-[calc(2lh_+_0.375rem)]",
  3: "max-h-[calc(3lh_+_0.375rem)]",
  4: "max-h-[calc(4lh_+_0.375rem)]",
} as const;

/**
 * A text area that grows with its text up to a number of lines, then scrolls, so the decision still fits on one
 * screen. The bottom padding sits outside the scrolling text, so a long text always stops at a whole line.
 */
function TextBox({ lines, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { lines: keyof typeof LINES }) {
  return (
    <div className="rounded-md border border-slate-300 bg-white pb-1.5 focus-within:border-accent focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent hover:border-slate-400">
      <textarea
        {...props}
        className={`block min-h-[calc(1lh_+_0.375rem)] w-full min-w-0 resize-none bg-transparent px-2.5 pt-1.5 text-sm text-slate-900 field-sizing-content focus-visible:outline-none max-sm:text-base ${LINES[lines]}`}
      />
    </div>
  );
}

/** Where the ticket number goes in a message when there is no number to show. */
const TICKET_TOKEN = "[new ticket number]";

/** What a decision led to, with links to see it from the tester's and the developers' side. */
export type Outcome = { text: string; links: { href: string; label: string }[] };

/** The person who decides in this demo. */
export type Manager = { name: string; team: string } | null;

/** `items` is every report not yet decided, for both tabs; which tab, bucket and report are open is kept here. */
export function ReviewDesk({
  items,
  tickets,
  rules,
  manager,
  initialRef,
}: {
  items: QueueItem[];
  tickets: TicketOption[];
  rules: Rule[];
  manager: Manager;
  /** A report to open first, for example one a tester has just sent. */
  initialRef?: string;
}) {
  const router = useRouter();
  const initial = initialRef ? items.find((i) => i.ref === initialRef) : undefined;
  const [tab, setTab] = useState<"review" | "waiting">(initial?.status === "needs_info" ? "waiting" : "review");
  const toReview = items.filter((i) => i.status === "awaiting_review" || i.status === "new");
  const waiting = items.filter((i) => i.status === "needs_info");
  // The queue can be narrowed to one bucket. A bucket emptied by decisions falls back to every report, so the queue
  // never looks finished while reports are still waiting.
  const [bucket, setBucket] = useState<Bucket | null>(null);
  const counts = QUEUE_BUCKETS.map((b) => ({ b, n: toReview.filter((i) => itemBucket(i, tickets) === b).length })).filter(
    (c) => c.n > 0,
  );
  const inBucket = bucket ? toReview.filter((i) => itemBucket(i, tickets) === bucket) : [];
  // Emptied, by this person or by someone else in the shared demo: let it go, so a later report of that kind does not
  // narrow the queue by itself.
  if (bucket && inBucket.length === 0) setBucket(null);
  const activeBucket = tab === "review" && inBucket.length > 0 ? bucket : null;
  const list = tab === "review" ? (activeBucket ? inBucket : toReview) : waiting;
  const [selectedId, setSelectedId] = useState<string | null>(initial?.id ?? list[0]?.id ?? null);
  // On a phone the list and the report take turns; on a wide screen both show.
  const [phoneDetail, setPhoneDetail] = useState(!!initial);
  // The notice after a decision. Each gets a new number that is never used again (`notices`), so a new one plays its
  // arrival and only the one being closed fades out.
  const [toast, setToast] = useState<(Outcome & { n: number }) | null>(null);
  const [leaving, setLeaving] = useState(0);
  const notices = useRef(0);

  const selected = list.find((i) => i.id === selectedId) ?? list[0] ?? null;
  // The report open when the page loads shows at once; once the person has moved to another, each new one fades in, so
  // the change of report is seen.
  const [moved, setMoved] = useState(false);
  function select(id: string | null) {
    setSelectedId(id);
    setMoved(true);
  }
  const analysing = items.some((i) => i.status === "new");
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // Each report opens at its top, and its row stays visible in the list (without scrolling the page).
  useEffect(() => {
    panelRef.current?.scrollTo({ top: 0 });
    const ul = listRef.current;
    const row = selected ? ul?.querySelector<HTMLElement>(`[data-row="${selected.id}"]`) : null;
    row?.scrollIntoView({ block: "nearest" });
  }, [selected?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Refresh while a report is being analysed, for three minutes at most: a failed analysis must not
  // keep every open tab polling the server. Once at the start too: the page may have been fetched a few seconds
  // before it was opened (the header fetches a page as the pointer reaches its link, fetch-on-intent.ts).
  useEffect(() => {
    if (!analysing) return;
    router.refresh();
    let ticks = 0;
    const t = setInterval(() => {
      if (++ticks > 45) clearInterval(t);
      else router.refresh();
    }, 4000);
    return () => clearInterval(t);
  }, [analysing, router]);

  useEffect(() => {
    if (!toast) return;
    const n = toast.n;
    const fade = setTimeout(() => setLeaving(n), 12000);
    const gone = setTimeout(() => setToast((t) => (t?.n === n ? null : t)), 12150);
    return () => {
      clearTimeout(fade);
      clearTimeout(gone);
    };
  }, [toast]);
  function closeToast(n: number) {
    setLeaving(n);
    setTimeout(() => setToast((t) => (t?.n === n ? null : t)), 150);
  }

  function pick(id: string) {
    select(id);
    setPhoneDetail(true);
    window.scrollTo({ top: 0 });
  }

  // Moving past the last report goes back to the first, so Skip always does something.
  function move(delta: number) {
    if (!selected || list.length === 0) return;
    const idx = list.findIndex((i) => i.id === selected.id);
    const next = list[(idx + delta + list.length) % list.length];
    if (next) select(next.id);
  }

  // J and K move through the list on either tab; the decision keys live in the decision form.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement;
      if (el.closest("input, textarea, select, [contenteditable], [role='listbox']")) return;
      if (e.metaKey || e.ctrlKey || e.altKey || document.documentElement.dataset.tour) return; // the tour only shows
      if (e.key === "j") move(1);
      else if (e.key === "k") move(-1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function onDecided(outcome: Outcome) {
    const idx = list.findIndex((i) => i.id === selected?.id);
    // Stay with the same problem first: the reports the AI matched to the one just decided, or to the
    // same pending report, come next while they are fresh in mind. Otherwise the next one in the list.
    const decided = selected?.analysis?.suggestion;
    // Only a report that joined another pending report has siblings; a nearby match is not the same problem.
    const target = decided?.suggested_action === "link_to_ticket" ? decided.match.target : null;
    const sameGroup = (i: QueueItem) =>
      i.id !== selected?.id &&
      (!!selected?.followers.includes(i.ref) ||
        (isFeedbackRef(target) &&
          i.analysis?.suggestion.suggested_action === "link_to_ticket" &&
          i.analysis.suggestion.match.target === target));
    // A chosen bucket keeps the queue in that bucket. Its last report done, back to every report, the same problem first.
    const inList = list.find(sameGroup) ?? list[idx + 1] ?? list[idx - 1] ?? null;
    const next =
      inList ?? (activeBucket ? (toReview.find(sameGroup) ?? toReview.find((i) => i.id !== selected?.id) ?? null) : null);
    if (activeBucket && !inList) setBucket(null);
    select(next?.id ?? null);
    if (!next) setPhoneDetail(false);
    notices.current += 1;
    setToast({ ...outcome, n: notices.current });
  }

  const position = selected ? list.findIndex((i) => i.id === selected.id) + 1 : 0;

  return (
    <div className="app-container py-4 lg:h-[calc(100vh-var(--chrome-h))]">
      <h1 className="sr-only">Review</h1>
      <div className="grid h-full grid-cols-1 gap-4 lg:grid-cols-[272px_minmax(0,1fr)]">
        <aside
          aria-label="Reports to decide"
          data-tour="queue"
          className={`flex min-h-0 flex-col overflow-hidden rounded-lg border border-box-line bg-white shadow-box ${phoneDetail ? "max-lg:hidden" : ""}`}
        >
          <BoxHeader
            icon={<Lines />}
            title="Reports"
            className="px-3"
            end={
              tab === "review" &&
              (counts.length > 1 || activeBucket) && (
                <BucketMenu
                  value={activeBucket}
                  total={toReview.length}
                  counts={counts}
                  onChange={(next) => {
                    setBucket(next);
                    // Open the bucket's first report, unless the one open already belongs to it.
                    if (next && (!selected || itemBucket(selected, tickets) !== next)) {
                      select(toReview.find((i) => itemBucket(i, tickets) === next)?.id ?? null);
                    }
                  }}
                />
              )
            }
          />
          <div className="flex gap-4 border-b border-slate-200 px-3 text-[13px]" role="tablist" aria-label="Queue">
            {(
              [
                ["review", "To review", toReview.length],
                ["waiting", "Waiting for tester", waiting.length],
              ] as const
            ).map(([key, label, count]) => (
              <button
                key={key}
                role="tab"
                aria-selected={tab === key}
                onClick={() => {
                  setTab(key);
                  select(null);
                  setBucket(null);
                }}
                className={`-mb-px border-b-2 py-2 ${tab === key ? "border-accent text-slate-900" : "border-transparent text-slate-600 hover:text-slate-900"}`}
              >
                {label} <span className="text-slate-500 tabular-nums">{count}</span>
              </button>
            ))}
          </div>
          <ul ref={listRef} aria-label="Reports" className="min-h-0 flex-1 overflow-y-auto">
            {list.length === 0 && (
              <li className="px-4 py-6 text-sm text-slate-500">{tab === "review" ? "Nothing to review." : "No open questions."}</li>
            )}
            {list.map((item) => (
              <li key={item.id} data-row={item.id}>
                <QueueRow item={item} tickets={tickets} active={item.id === selected?.id} onClick={() => pick(item.id)} />
              </li>
            ))}
          </ul>
        </aside>

        <div ref={panelRef} className={`min-h-0 min-w-0 lg:overflow-y-auto ${phoneDetail ? "" : "max-lg:hidden"}`}>
          {selected && (
            <div className="mb-3 flex items-center justify-between text-sm lg:hidden">
              <button onClick={() => setPhoneDetail(false)} className="text-accent">
                ‹ All reports
              </button>
              <span className="text-slate-500 tabular-nums">
                {position} of {list.length}
              </span>
            </div>
          )}
          <div
            role="status"
            className="pointer-events-none fixed inset-x-0 top-[4.25rem] z-50 flex justify-center px-4 max-lg:top-[6.25rem]"
          >
            {toast && (
              <p
                key={toast.n}
                className={`drop-in pointer-events-auto flex max-w-[44rem] flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-slate-300 bg-white py-2.5 pr-2.5 pl-4 text-sm text-slate-900 shadow-[0_10px_30px_rgba(15,23,42,0.18)] ${
                  leaving === toast.n ? "-translate-y-1 opacity-0 transition duration-150 ease-in" : ""
                }`}
              >
                <Check className="h-4 w-4 shrink-0" draw />
                <span>{toast.text}</span>
                {toast.links.map((l) => (
                  <Link key={l.href} href={l.href} className="font-medium text-accent hover:underline">
                    {l.label}
                  </Link>
                ))}
                <button
                  onClick={() => closeToast(toast.n)}
                  aria-label="Close"
                  className="flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                >
                  <Cross className="h-4 w-4" />
                </button>
              </p>
            )}
          </div>
          {selected ? (
            <ItemView
              key={`${selected.id}:${selected.analysis?.id ?? "none"}:${selected.resolvedTarget?.ticketKey ?? ""}`}
              fade={moved}
              item={selected}
              position={{ at: position, of: list.length }}
              tickets={tickets}
              rules={rules}
              manager={manager}
              onMove={move}
              onDecided={onDecided}
              onOpenRef={(ref) => {
                const target = items.find((i) => i.ref === ref);
                if (target) {
                  setTab(target.status === "needs_info" ? "waiting" : "review");
                  // A chosen bucket would hide it: show every report.
                  if (activeBucket && itemBucket(target, tickets) !== activeBucket) setBucket(null);
                  select(target.id);
                }
              }}
            />
          ) : tab === "review" ? (
            // In the shared demo someone may have decided everything already: offer a way back in.
            <div className="rounded-lg border border-box-line bg-white shadow-box px-6 py-12 text-center text-sm text-slate-600">
              <p className="text-base font-medium text-slate-900">Every report has been decided.</p>
              <p className="mt-2">Start the demo over to bring back the sample reports, or import a spreadsheet of new ones.</p>
              <div className="mt-4 flex flex-wrap items-center justify-center gap-4">
                <ResetDemo />
                <Link href="/import" className="text-accent hover:underline">
                  Import a spreadsheet
                </Link>
              </div>
            </div>
          ) : (
            <p className="rounded-lg border border-box-line bg-white shadow-box px-6 py-12 text-center text-sm text-slate-500">
              No report is waiting for a tester&apos;s answer.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function QueueRow({
  item,
  tickets,
  active,
  onClick,
}: {
  item: QueueItem;
  tickets: TicketOption[];
  active: boolean;
  onClick: () => void;
}) {
  const a = item.analysis?.suggestion;
  const targetKey = item.resolvedTarget?.ticketKey ?? a?.match.target;
  const waiting = item.status === "needs_info";
  const bucket = itemBucket(item, tickets);
  return (
    <button
      onClick={onClick}
      aria-current={active}
      className={`block w-full border-b border-l-2 border-b-slate-100 px-3 py-2 text-left ${
        active ? "border-l-accent bg-accent-soft/70" : "border-l-transparent hover:bg-slate-50"
      }`}
    >
      <div className="flex items-baseline justify-between gap-2 text-xs text-slate-500">
        <span className="shrink-0 whitespace-nowrap">
          <span className="font-mono text-slate-700">{item.ref}</span> · {formatDay(item.submitted_at)}
        </span>
        <span className="min-w-0 truncate">{item.tester?.name ?? "Unknown tester"}</span>
      </div>
      <p className="mt-0.5 line-clamp-1 text-[13px] leading-[1.125rem] text-slate-900">{item.text}</p>
      <div className="mt-1 flex items-center gap-1.5 text-xs">
        {waiting ? (
          <span className="line-clamp-1 text-amber-900">Asked: {item.follow_up_question}</span>
        ) : item.status === "new" ? (
          <span className="text-slate-500">Analysing…</span>
        ) : a && item.analysis && bucket ? (
          <>
            <AiTag />
            <span className="min-w-0 truncate text-slate-700">
              {bucketLine(bucket, a.suggested_action === "link_to_ticket" ? targetKey : null)}
            </span>
            <span className="ml-auto shrink-0">
              <Confidence value={item.analysis.confidence} />
            </span>
          </>
        ) : null}
        {item.follow_up_answer && !waiting && <Pill>replied</Pill>}
      </div>
    </button>
  );
}

/** Which reports the list shows: all of them, or one bucket. Each choice carries its count. */
function BucketMenu({
  value,
  total,
  counts,
  onChange,
}: {
  value: Bucket | null;
  total: number;
  counts: { b: Bucket; n: number }[];
  onChange: (bucket: Bucket | null) => void;
}) {
  const options: { value: Bucket | "all"; label: string; n: number }[] = [
    { value: "all", label: "All reports", n: total },
    ...counts.map(({ b, n }) => ({ value: b, label: BUCKET_LABEL[b], n })),
  ];
  const current = value ? counts.find((c) => c.b === value) : null;
  return (
    <Listbox value={value ?? "all"} onChange={(v: Bucket | "all") => onChange(v === "all" ? null : v)}>
      <ListboxButton
        aria-label="Show reports"
        className={`flex h-7 shrink-0 items-center gap-1.5 rounded-md border bg-white pr-1.5 pl-2.5 text-[13px] whitespace-nowrap hover:border-slate-400 data-open:border-accent ${
          current ? "border-accent/50 text-accent" : "border-slate-300 text-slate-900"
        }`}
      >
        {current ? BUCKET_LABEL[current.b] : "All"} <span className="tabular-nums">{current ? current.n : total}</span>
        <ChevronDown className="h-3.5 w-3.5 text-slate-500" />
      </ListboxButton>
      <ListboxOptions
        anchor={{ to: "bottom end", gap: 4, padding: 8 }}
        modal={false}
        className="z-50 w-52 rounded-md border border-slate-200 bg-white p-1 text-sm shadow-lg focus:outline-none"
      >
        {options.map((o) => (
          <ListboxOption
            key={o.value}
            value={o.value}
            className="group flex cursor-default items-center gap-2 rounded px-2 py-1.5 select-none data-focus:bg-slate-100"
          >
            <Check className="invisible h-4 w-4 shrink-0 text-accent group-data-selected:visible" />
            <span className="min-w-0 flex-1 text-slate-900 group-data-selected:font-medium">{o.label}</span>
            <span className="text-slate-500 tabular-nums">{o.n}</span>
          </ListboxOption>
        ))}
      </ListboxOptions>
    </Listbox>
  );
}

/** One AI run's choice in a few words, "Add to MIA-101" or the outcome's name; runs agree when these match. */
function headline(a: Analysis, resolvedKey?: string): string {
  if (a.suggested_action === "link_to_ticket") return `Add to ${resolvedKey ?? a.match.target ?? "a ticket"}`;
  return ACTION_LABEL[a.suggested_action];
}

/**
 * The open report and its decision. ReviewDesk keys it on the report, its analysis and any matched report's new ticket,
 * so a fresh analysis starts the decision over.
 */
function ItemView({
  item,
  fade,
  position,
  tickets,
  rules,
  manager,
  onMove,
  onDecided,
  onOpenRef,
}: {
  item: QueueItem;
  fade: boolean;
  position: { at: number; of: number };
  tickets: TicketOption[];
  rules: Rule[];
  manager: Manager;
  onMove: (delta: number) => void;
  onDecided: (outcome: Outcome) => void;
  onOpenRef: (ref: string) => void;
}) {
  const waitingForTester = item.status === "needs_info";
  // After a tester answers, the report is reviewed again: its older suggestion must not be approved meanwhile.
  const beingAnalysed = item.status === "new";
  // A report waiting for the tester can still be decided, but only on purpose.
  const [decideAnyway, setDecideAnyway] = useState(false);
  const showDecision = !!item.analysis && !beingAnalysed && (!waitingForTester || decideAnyway);
  const name = item.tester ? firstName(item.tester.name) : "the tester";
  // A one-click overrule from the suggestion; the counter lets the same choice be made twice.
  const [overrule, setOverrule] = useState<Overrule | null>(null);

  // On a wide screen: report and the AI's view in the middle, the decision on the right, each scrolling on its own.
  return (
    <article className={`${showDecision ? "grid gap-4 xl:h-full xl:grid-cols-[minmax(0,1fr)_488px]" : "grid gap-4"} ${fade ? "fade-in" : ""}`}>
      {/* Its boxes keep their full height and the column scrolls: a box with overflow-hidden would otherwise shrink and cut its last lines. */}
      <div className="flex min-w-0 flex-col gap-3 xl:overflow-y-auto [&>*]:shrink-0">
        <ReportCard item={item} name={name} position={position} />
        {waitingForTester && (
          <WaitingForTester
            item={item}
            name={name}
            onDecideAnyway={item.analysis && !decideAnyway ? () => setDecideAnyway(true) : undefined}
          />
        )}
        {!waitingForTester && (beingAnalysed || !item.analysis) && <Analysing item={item} again={!!item.follow_up_answer} />}
        {item.analysis && !beingAnalysed && (
          <Suggestion
            item={item}
            tickets={tickets}
            rules={rules}
            name={name}
            onOpenRef={onOpenRef}
            onOverrule={(o) => {
              setDecideAnyway(true);
              setOverrule((prev) => ({ ...o, n: (prev?.n ?? 0) + 1 }));
            }}
          />
        )}
      </div>
      {showDecision && (
        <DecisionForm
          item={item}
          tickets={tickets}
          manager={manager}
          overrule={overrule}
          onMove={onMove}
          onDecided={onDecided}
        />
      )}
    </article>
  );
}

/**
 * The tester's report: their words first, then the step it was written against. It wears the same mark as its row in
 * the list (a blue bar on the left), so it is clear which report is open.
 */
function ReportCard({ item, name, position }: { item: QueueItem; name: string; position: { at: number; of: number } }) {
  const Name = item.tester ? name : "The tester";
  return (
    <section aria-label="Report" className="overflow-hidden rounded-lg border border-l-[3px] border-box-line border-l-accent bg-white shadow-box">
      <BoxHeader
        icon={<Speech />}
        // A phone shows "N of M" above the box, so there the title is for screen readers only.
        title={position.at > 0 ? `Report ${position.at} of ${position.of}` : "Report"}
        titleClassName="mr-1 max-lg:sr-only"
        detail={
          <span className="min-w-0 truncate text-meta text-slate-500">
            <span className="font-mono text-sm font-medium text-slate-900">{item.ref}</span> · {formatWhen(item.submitted_at)}
            {item.source === "import" && " · imported from a spreadsheet"}
          </span>
        }
        end={
          // The team shows only where it fits whole: otherwise it wraps to a second line, which is cut off. A phone gives
          // the tester a line of their own.
          <span
            className="flex h-5 min-w-0 flex-1 flex-wrap items-baseline justify-end overflow-hidden text-meta max-sm:basis-full max-sm:justify-start"
            title={item.tester ? `${item.tester.name} · ${item.tester.team}` : undefined}
          >
            <span className="min-w-0 truncate text-sm font-medium text-slate-900">{item.tester?.name ?? "Unknown tester"}</span>
            {item.tester && <span className="whitespace-pre text-slate-500"> · {item.tester.team}</span>}
          </span>
        }
      />
      <div className="px-4 py-2.5">
        <p className="text-[15px] leading-6 text-slate-900">&ldquo;{item.text}&rdquo;</p>
        <dl className="mt-2 grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
          {item.step ? (
            <>
              <dt className="text-slate-500">Step</dt>
              <dd className="flex flex-wrap items-baseline gap-x-2">
                <span>
                  <span className="font-mono text-meta text-slate-600">{item.step.id}</span> {item.step.instruction}
                </span>
                {item.reported_result && <StepResult result={item.reported_result} />}
              </dd>
              <dt className="text-slate-500">Expected</dt>
              <dd className="text-slate-700">{item.step.expected}</dd>
            </>
          ) : (
            <>
              <dt className="text-slate-500">Step</dt>
              <dd className="text-slate-600">No test step: general feedback</dd>
            </>
          )}
          {item.follow_up_question && (
            <>
              <dt className="text-slate-500">Asked</dt>
              <dd className="text-slate-700">{item.follow_up_question}</dd>
              {item.follow_up_answer && (
                <>
                  <dt className="text-slate-500">{Name} replied</dt>
                  <dd className="text-slate-900">{item.follow_up_answer}</dd>
                </>
              )}
            </>
          )}
        </dl>
      </div>
    </section>
  );
}

function StepResult({ result }: { result: "pass" | "fail" }) {
  return result === "fail" ? (
    <span className="inline-flex items-center gap-1 text-meta font-medium text-red-700">
      <Cross className="h-3.5 w-3.5" /> Failed
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-meta font-medium text-slate-700">
      <Check className="h-3.5 w-3.5" /> Passed
    </span>
  );
}

/** A question has gone to the tester: say so, and offer to answer it as them. */
function WaitingForTester({ item, name, onDecideAnyway }: { item: QueueItem; name: string; onDecideAnyway?: () => void }) {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
      <p className="font-medium">Waiting for {name}&apos;s answer.</p>
      <p className="mt-1">Once {name} replies, the AI reviews the report again and it comes back to To review.</p>
      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
        {item.tester && (
          <Link href={`/tester?as=${item.tester.id}`} className="font-medium text-accent hover:underline">
            Demo: reply as {name}
            <LinkArrow />
          </Link>
        )}
        {onDecideAnyway && (
          <button onClick={onDecideAnyway} className="text-slate-700 underline hover:no-underline">
            Decide without waiting
          </button>
        )}
      </div>
    </div>
  );
}

/** How long a report may wait for the AI before a retry is offered. Long enough for the last rows of an import. */
const SLOW_AFTER_MS = 90_000;
/** When this browser first saw each report waiting for the AI, so switching reports does not restart the wait. */
const waitingSince = new Map<string, number>();

/**
 * The AI is still on it. The retry appears only once the usual wait is long past, so it is seldom pressed while the first
 * analysis is still running (the server allows that one up to 120 seconds, and both would be paid for).
 */
function Analysing({ item, again }: { item: QueueItem; again: boolean }) {
  const [slow, setSlow] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!waitingSince.has(item.id)) waitingSince.set(item.id, Date.now());
    const left = waitingSince.get(item.id)! + SLOW_AFTER_MS - Date.now();
    const t = setTimeout(() => setSlow(true), Math.max(0, left));
    return () => clearTimeout(t);
  }, [item.id]);

  return (
    <div className="rounded-lg border border-box-line bg-white shadow-box p-4 text-sm text-slate-600">
      {!slow ? (
        <p>
          <AiTag className="mr-2" />
          {again ? "The AI is reviewing the report again with the tester's answer." : "The AI is reviewing this report."} It
          usually takes about 10 seconds.
        </p>
      ) : (
        <p>
          This is taking longer than usual.{" "}
          <button
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                setError(null);
                const r = await reanalyseAction(item.id);
                if (!r.ok) setError(r.error);
              })
            }
            className="text-accent hover:underline disabled:opacity-50"
          >
            <BusyLabel busy={pending} busyText="Analysing…">
              Analyse now
            </BusyLabel>
          </button>
        </p>
      )}
      {error && <p className="mt-2 text-red-700">{error}</p>}
    </div>
  );
}

/** One click from the panel to a different outcome; the decision form picks it up. */
export type Overrule = { action: Action; ticketKey?: string; relation?: "exact_duplicate" | "different_aspect"; n: number };

/** The queue's buckets, in the order a manager would want to see them. */
const QUEUE_BUCKETS: Bucket[] = [
  "new_bug",
  "same_bug",
  "other_symptom",
  "already_known",
  "thin_evidence",
  "idea",
  "by_design",
  "question",
  "nothing_to_fix",
];

/** The bucket a queued report's suggestion puts it in; none while it is being analysed. */
function itemBucket(item: QueueItem, tickets: TicketOption[]): Bucket | null {
  const a = item.analysis?.suggestion;
  if (!a || item.status === "new") return null;
  return bucketFor(a, tickets.find((t) => t.key === (item.resolvedTarget?.ticketKey ?? a.match.target)));
}

/** The bucket the AI's suggestion puts this report in, worked out from the outcome and the ticket it points at. */
function bucketFor(a: Analysis, target: TicketOption | undefined) {
  return bucketOf({
    action: a.suggested_action,
    relation: a.match.relation,
    targetOrigin: target?.origin ?? null,
    targetKind: target?.kind ?? null,
    category: a.category,
  });
}

/** One AI run in a few words, with the ticket it came near when it did not link to it. */
function runLabel(s: Analysis): string {
  return `${headline(s)}${s.match.target && s.suggested_action !== "link_to_ticket" ? ` (near ${s.match.target})` : ""}`;
}

/**
 * Up to two other outcomes worth one click: a ticket the AI also considered, what another run chose, or the plain
 * opposite of the suggestion.
 */
function alternatives(item: QueueItem, tickets: TicketOption[], targetKey: string | null | undefined) {
  const a = item.analysis!.suggestion;
  const out: Omit<Overrule, "n">[] = [];
  const add = (o: Omit<Overrule, "n">) => {
    const same = (x: Omit<Overrule, "n">) => x.action === o.action && (x.ticketKey ?? "") === (o.ticketKey ?? "");
    const isSuggestion = o.action === a.suggested_action && (o.action !== "link_to_ticket" || o.ticketKey === targetKey);
    if (!isSuggestion && !out.some(same)) out.push(o);
  };
  for (const c of a.other_candidates) {
    if (tickets.some((t) => t.key === c.target)) {
      // Only an exact match joins as the same problem; anything looser joins as another symptom.
      add({ action: "link_to_ticket", ticketKey: c.target, relation: c.relation === "exact_duplicate" ? "exact_duplicate" : "different_aspect" });
    }
  }
  for (const s of item.analysis!.samples) {
    if (s.suggested_action === "link_to_ticket") {
      if (s.match.target && tickets.some((t) => t.key === s.match.target)) add({ action: "link_to_ticket", ticketKey: s.match.target });
    } else add({ action: s.suggested_action });
  }
  add({ action: a.suggested_action === "create_ticket" ? "ask_tester" : "create_ticket" });
  return out.slice(0, 2);
}

function overruleLabel(o: Omit<Overrule, "n">): string {
  return o.action === "link_to_ticket" ? `Add to ${o.ticketKey}` : ACTION_LABEL[o.action];
}

/** The AI's view of the open report. It saves nothing: an overrule goes to DecisionForm through ItemView. */
function Suggestion({
  item,
  tickets,
  rules,
  name,
  onOpenRef,
  onOverrule,
}: {
  item: QueueItem;
  tickets: TicketOption[];
  rules: Rule[];
  name: string;
  onOpenRef: (ref: string) => void;
  onOverrule: (o: Omit<Overrule, "n">) => void;
}) {
  const analysis = item.analysis!;
  const a = analysis.suggestion;
  const d = analysis.confidence_detail;
  const targetKey = item.resolvedTarget?.ticketKey ?? a.match.target;
  const target = tickets.find((t) => t.key === targetKey);
  const pendingTarget = a.suggested_action === "link_to_ticket" && isFeedbackRef(targetKey) ? targetKey : null;
  const rule = a.rule_id ? rules.find((r) => r.id === a.rule_id) : undefined;
  const capped = 0.5 * d.agreement + 0.5 * d.self_reported - d.raw > 0.02;
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const asks = a.suggested_action === "ask_tester";
  const bucket = bucketFor(a, target);
  const { title, action } = bucketHeadline(bucket, a.suggested_action === "link_to_ticket" ? targetKey : null, name);
  const others = alternatives(item, tickets, targetKey);
  // Runs that chose the same outcome agree, even if only some noticed a nearby ticket (that is in Why flagged).
  const sameRuns = new Set(analysis.samples.map((s) => headline(s))).size === 1;
  // The spread of the runs' own estimates, when they differ: "88–90%".
  const selfRated = analysis.samples.map((s) => Math.round(s.confidence_self));
  const runRange =
    Math.min(...selfRated) < Math.max(...selfRated) ? `${Math.min(...selfRated)}–${Math.max(...selfRated)}%` : null;

  // Why flagged: facts the app knows for certain first, then what the AI read in the words. What the headline or the
  // decision card already says (the ticket's reports, "known before testing", how little the report says) is left out.
  const facts: React.ReactNode[] = [];
  if (target && a.match.relation !== "none") {
    if (item.step_id && target.step_id === item.step_id) facts.push(<>Same test step as {target.key} ({item.step_id})</>);
    else if (item.step_id && target.step_id && item.step_id.split(".")[0] === target.step_id.split(".")[0]) {
      facts.push(<>Same test script as {target.key} ({item.step_id.split(".")[0]})</>);
    }
    if (target.origin === "known_issue" && bucket !== "already_known") facts.push(<>{target.key} was logged before testing started</>);
    if (a.match.relation === "related") facts.push(<>Related to {target.key}, but a different problem</>);
  }
  if (a.suggested_action === "create_ticket") {
    const near = tickets.find((t) => a.other_candidates.some((c) => c.target === t.key));
    if (near) {
      const sameStep = !!item.step_id && near.step_id === item.step_id;
      facts.push(
        <>
          Nearest ticket {near.key}
          {sameStep ? ` is on the same step (${item.step_id}),` : ""} but the AI reads a different problem
        </>,
      );
    } else if (a.match.relation === "none") facts.push(<>No existing ticket describes this</>);
  }
  if (a.match.shared_signals.length > 0) facts.push(<>Similar: {a.match.shared_signals.join("; ")}</>);
  if (a.match.differences.length > 0) facts.push(<span className="text-slate-600">Differs: {a.match.differences.join("; ")}</span>);
  if (asks && a.evidence.missing.length > 0) facts.push(<>Missing: {a.evidence.missing.join("; ")}</>);
  if (rule) facts.push(<>Rule {rule.id}: {rule.rule}</>);
  for (const c of a.other_candidates) facts.push(<>Also considered {c.target}: {c.why}</>);

  // How sure: the track record and how the figure is worked out sit behind the (i). A line shows only when there is
  // something to watch: the figure is capped, or the sample reports cannot vouch for it.
  const { bin } = calibrate(d.raw);
  const measured = !!bin && bin.n >= 5;
  const trackRecord = measured
    ? `Right ${bin.correct} of ${bin.n} times at ${Math.round(bin.min * 100)}–${Math.round(bin.max * 100)}% on sample reports.`
    : bin
      ? "Too few sample reports at this level to judge. Check closely."
      : "Not measured for this range.";
  const warn = capped || !measured;
  const formula =
    d.samples === 1
      ? `One AI run chose this and rated itself ${pct(d.self_reported)} sure.`
      : capped
        ? `${d.agreeing === d.samples ? `All ${d.samples}` : `${d.agreeing} of ${d.samples}`} separate AI runs chose this; on average they rated themselves ${pct(d.self_reported)} sure, capped at 50% because the report lacks detail.`
        : `Score: ½ × agreement ${pct(d.agreement)} + ½ × own estimate ${pct(d.self_reported)}${sameRuns && runRange ? ` (${runRange})` : ""} = ${pct(d.raw)}.`;
  // The (i) always starts with what was measured at this level, even when it is too little to quote a rate.
  const range = bin ? `${Math.round(bin.min * 100)}–${Math.round(bin.max * 100)}%` : "";
  const record = measured
    ? trackRecord
    : bin && bin.n > 0
      ? `Only ${bin.n} sample report${bin.n === 1 ? "" : "s"} at ${range}, ${bin.correct} right: too few to judge.`
      : "No sample reports at this level.";
  const tip = `${record} ${formula} Measured on our ${calibrationInfo().dataset}, which were also used to tune the AI; not yet on real data.`;

  return (
    <section aria-label="AI suggestion" data-tour="suggestion" className="overflow-hidden rounded-lg border border-box-line bg-white shadow-box">
      <BoxHeader icon={<AiTag />} title="AI suggestion" />
      <div className="px-4 py-3">
        {/* The bucket is the headline; how sure the AI is sits beside it. */}
        <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1">
          <p className="text-xl leading-[1.625rem] font-semibold text-slate-900">
            {title}
            {action && <span className="text-[15px] font-normal text-slate-700"> · {action}</span>}
          </p>
          <span className="ml-auto flex items-center gap-2 text-meta text-slate-700">
            <Sure value={analysis.confidence} />
            <ConfidenceBar value={analysis.confidence} />
            <Agreement agreeing={d.agreeing} samples={d.samples} />
            <InfoTip label="How sure, and how the figure is worked out" text={tip} />
          </span>
        </div>
        {item.followers.length > 0 && (
          // Reports the AI matched to this one. Each is still decided on its own.
          <p className="mt-1.5 text-meta">
            <Tip reach text="Each report is decided on its own.">
              <span className="inline-flex flex-wrap items-center gap-x-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-slate-800">
                +{item.followers.length} similar report{item.followers.length === 1 ? "" : "s"}:
                {item.followers.map((ref, i) => (
                  <span key={ref}>
                    <button className="font-mono text-xs text-accent hover:underline" onClick={() => onOpenRef(ref)}>
                      {ref}
                    </button>
                    {i < item.followers.length - 1 && ","}
                  </span>
                ))}
              </span>
            </Tip>
          </p>
        )}
        <p className="mt-2 text-sm leading-[1.3125rem] text-slate-700">{a.explanation}</p>

        {item.resolvedTarget && (
          <p className="mt-2 text-sm text-slate-700">
            {item.resolvedTarget.ref} has since become {item.resolvedTarget.ticketKey}.
          </p>
        )}
        {pendingTarget && (
          <p className="mt-2 text-sm text-amber-900">
            {pendingTarget} is not decided yet.{" "}
            <button className="text-accent hover:underline" onClick={() => onOpenRef(pendingTarget)}>
              Open {pendingTarget}
            </button>{" "}
            or create the ticket from this one.
          </p>
        )}

        <div className="mt-2.5 rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-800">
          {facts.length > 0 && (
            <>
              <p className="font-medium text-slate-900">Why flagged</p>
              <ul className="mt-0.5 grid gap-0.5">
                {facts.map((f, i) => (
                  <li key={i} className="flex gap-2">
                    <span aria-hidden className="text-slate-400">
                      –
                    </span>
                    <span className="min-w-0">{f}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {others.length > 0 && (
            <p className={`flex flex-wrap items-center gap-x-2 gap-y-1 ${facts.length ? "mt-2" : ""}`}>
              <span className="text-slate-700">Not sure? Overrule in one click:</span>
              {others.map((o) => (
                <button
                  key={`${o.action}:${o.ticketKey ?? ""}`}
                  onClick={() => onOverrule(o)}
                  className="rounded border border-slate-300 bg-white px-2 py-0.5 text-meta text-slate-800 hover:border-accent hover:text-accent"
                >
                  {overruleLabel(o)}
                </button>
              ))}
            </p>
          )}
        </div>

        {a.evidence.quality !== "complete" && bucket !== "thin_evidence" && (
          <p className="mt-2 text-[13.5px] text-slate-700">
            <span className="mr-2 text-slate-500">Evidence</span>
            <EvidenceChip quality={a.evidence.quality} />
            {" · "}
            {a.evidence.known.length > 0 ? `has: ${a.evidence.known.join("; ")}` : "not much to go on"}
            {!asks && a.evidence.missing.length > 0 && <> · missing: {a.evidence.missing.join("; ")}</>}
          </p>
        )}
        {warn && (
          <p className="mt-2 text-[13.5px] text-amber-900">
            {capped && "Capped at 50%: the report lacks detail. "}
            {measured ? "" : trackRecord}
          </p>
        )}
        {/* When every run chose the same, the agreement dots say it all; only a split gets a line. */}
        {analysis.samples.length > 1 && !sameRuns && (
          <p className="mt-1 text-meta text-slate-600">
            Each run:{" "}
            {analysis.samples.map((s, i) => (
              <span key={i}>
                {i > 0 && <span className="text-slate-400"> · </span>}
                {runLabel(s)} <span className="text-slate-500 tabular-nums">{Math.round(s.confidence_self)}%</span>
              </span>
            ))}
          </p>
        )}
      </div>
    </section>
  );
}

/** How sure, large enough to read at a glance; amber below 85%. */
function Sure({ value }: { value: number }) {
  // On the figure shown: 0.846 reads 85%, so it is not amber.
  const doubtful = Math.round(value * 100) < 85;
  return (
    <span className="whitespace-nowrap">
      <span className={`text-[15px] font-semibold tabular-nums ${doubtful ? "text-amber-800" : "text-slate-900"}`}>
        {Math.round(value * 100)}%
      </span>{" "}
      sure
      {doubtful && <span className="sr-only"> (lower confidence: check closely)</span>}
    </span>
  );
}

/** How much the report says, in words; only too little detail is marked, since it needs a person's attention. */
function EvidenceChip({ quality }: { quality: "complete" | "partial" | "insufficient" }) {
  return (
    <span className={quality === "insufficient" ? "font-medium text-amber-900" : "font-medium text-slate-800"}>
      {EVIDENCE_LABEL[quality]}
    </span>
  );
}

/** The message when the manager picks a different outcome from the AI's. `key` is the ticket chosen for linking. */
const MESSAGE_TEMPLATES: Record<Action, (name: string, key: string) => string> = {
  create_ticket: (n, key) => `Thanks ${n}. This is now ticket ${key}.`,
  link_to_ticket: (n, key) => `Thanks ${n}. This was already reported, so we added your report to ${key || "the ticket"}.`,
  add_to_ideas: (n, key) => `Thanks ${n}. We added this to the ideas backlog as ${key}.`,
  ask_tester: () => "",
  answer: (n) => `Thanks ${n}. `,
  acknowledge: (n) => `Thanks ${n}, noted.`,
};

/** A starting ticket when the AI did not draft one: the tester's own words and the step, for the manager to edit. */
function draftFromReport(item: QueueItem): TicketDraft {
  const words = item.text.replace(/\s+/g, " ").trim();
  const sentence = words.split(/(?<=[.!?])\s/)[0];
  const title = sentence.length <= 80 ? sentence.replace(/[.!?]$/, "") : `${sentence.slice(0, 77).replace(/\s\S*$/, "")}…`;
  return {
    title: item.step && title.length < 25 ? `${item.step.id}: ${title}` : title,
    summary: words,
    steps_to_reproduce: item.step ? [item.step.instruction] : [],
    expected: item.step?.expected ?? "",
    actual: words,
    severity: "medium",
  };
}

/**
 * The AI writes {ticket} where the new number goes. People see the number it will most likely get; it is turned
 * back into {ticket} when saved, so the tester reads the number actually given even if someone else took that one.
 */
const TICKET_PLACEHOLDER = "{ticket}";
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** For the screen: {ticket} becomes the number it will most likely get, or "[new ticket number]". */
const readable = (m: string, token: string) => m.replaceAll(TICKET_PLACEHOLDER, token);
/** For keeping and saving: that number back to {ticket}, which decide() fills with the number actually given. */
const stored = (m: string, token: string) => m.replaceAll(token, TICKET_PLACEHOLDER);

/** After a new report opens, A waits this long: pressing it repeatedly must not clear the queue. */
const APPROVE_GUARD_MS = 900;

/** Where the decision is made and saved (decideAction), starting on the AI's suggestion. Keys 1 to 6 and A act here. */
function DecisionForm({
  item,
  tickets,
  manager,
  overrule,
  onMove,
  onDecided,
}: {
  item: QueueItem;
  tickets: TicketOption[];
  manager: Manager;
  /** The latest one-click overrule from the suggestion panel. */
  overrule: Overrule | null;
  onMove: (delta: number) => void;
  onDecided: (outcome: Outcome) => void;
}) {
  const a = item.analysis!.suggestion;
  const name = firstName(item.tester?.name);
  const aiTarget = item.resolvedTarget?.ticketKey ?? a.match.target ?? "";
  const aiTargetIsTicket = !!tickets.find((t) => t.key === aiTarget);
  const openedAt = useRef(0);
  useEffect(() => {
    openedAt.current = Date.now();
  }, []);

  // Deciding a report that is waiting for the tester: do not start on asking the same question again.
  const [action, setAction] = useState<Action>(() => {
    if (item.status !== "needs_info" || a.suggested_action !== "ask_tester") return a.suggested_action;
    return item.analysis!.samples.find((s) => s.suggested_action !== "ask_tester")?.suggested_action ?? "create_ticket";
  });
  // What the decision will create shows as it will look; Edit turns it into the fields, in the same place.
  const [editing, setEditing] = useState(false);
  // The tester's message is edited where it is shown, not in the form above.
  const [editingMessage, setEditingMessage] = useState(false);
  function choose(act: Action) {
    setAction(act);
    setEditing(false);
    setEditingMessage(false);
  }
  // Overruling should be one click: if the AI's match is not a ticket, start from the ticket it also considered.
  const [linkKey, setLinkKey] = useState(
    aiTargetIsTicket ? aiTarget : (a.other_candidates.find((c) => tickets.some((t) => t.key === c.target))?.target ?? ""),
  );
  const [relation, setRelation] = useState<"exact_duplicate" | "different_aspect">(
    a.match.relation === "different_aspect" ? "different_aspect" : "exact_duplicate",
  );
  const [draft, setDraft] = useState<TicketDraft>(() => {
    const own = draftFromReport(item);
    return {
      title: a.draft_ticket?.title ?? own.title,
      summary: a.draft_ticket?.summary ?? own.summary,
      steps_to_reproduce: a.draft_ticket?.steps_to_reproduce ?? own.steps_to_reproduce,
      expected: a.draft_ticket?.expected ?? own.expected,
      actual: a.draft_ticket?.actual ?? own.actual,
      severity: a.draft_ticket?.severity ?? own.severity,
    };
  });
  const [question, setQuestion] = useState(a.follow_up_question ?? "");
  // The number the next ticket or idea will get, worked out the way the server gives it.
  const nextBug = nextTicketKey(tickets, "bug");
  const nextIdea = nextTicketKey(tickets, "idea");
  const tokenFor = (act: Action) => (act === "create_ticket" ? nextBug : act === "add_to_ideas" ? nextIdea : TICKET_TOKEN);
  // The AI may have matched another report that has since become a ticket: the tester should read the ticket's number.
  const aiReplyText = item.resolvedTarget
    ? a.tester_reply.replace(new RegExp(`\\b${escapeRegExp(item.resolvedTarget.ref)}\\b`, "g"), item.resolvedTarget.ticketKey)
    : a.tester_reply;
  // Messages are kept with {ticket} where the new number goes and shown with the number it will most likely get, so
  // the number on screen follows the ticket list, before and after a refresh, and is never saved as a stale literal.
  const [messages, setMessages] = useState<Partial<Record<Action, string>>>({ [a.suggested_action]: aiReplyText });
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const message = readable(
    messages[action] ?? MESSAGE_TEMPLATES[action](name, action === "link_to_ticket" ? linkKey : TICKET_PLACEHOLDER),
    tokenFor(action),
  );
  const setMessage = (m: string) => setMessages((prev) => ({ ...prev, [action]: stored(m, tokenFor(action)) }));
  const matchesAi = action === a.suggested_action && (action !== "link_to_ticket" || linkKey === aiTarget);
  const chosen = tickets.find((t) => t.key === linkKey);

  // Choosing a different ticket swaps an untouched message for one that names the chosen ticket.
  function chooseTicket(key: string) {
    const before = linkKey;
    setLinkKey(key);
    setMessages((prev) => {
      const current = prev.link_to_ticket;
      const aiReply = a.suggested_action === "link_to_ticket" ? aiReplyText : null;
      const untouched =
        current === undefined || current === aiReply || current === MESSAGE_TEMPLATES.link_to_ticket(name, before);
      if (!untouched) return prev;
      return {
        ...prev,
        link_to_ticket: aiReply && key === aiTarget ? aiReply : MESSAGE_TEMPLATES.link_to_ticket(name, key),
      };
    });
  }
  // A one-click overrule from the suggestion panel: take it once, when it arrives. A form that opens because of one
  // (a report waiting for the tester) takes it straight away.
  const [overruleSeen, setOverruleSeen] = useState(0);
  if (overrule && overrule.n !== overruleSeen) {
    setOverruleSeen(overrule.n);
    choose(overrule.action);
    if (overrule.ticketKey) chooseTicket(overrule.ticketKey);
    if (overrule.relation) setRelation(overrule.relation);
  }

  const mentioned =
    action === "link_to_ticket" && linkKey
      ? // Ticket keys and report refs the message mentions, to catch one that names something other than the ticket chosen.
        [...message.matchAll(keyPattern(tickets.map((t) => t.key)))].map((m) => m[0]).filter((k) => k !== item.ref)
      : [];
  const otherTicket =
    mentioned.length > 0 && !mentioned.includes(linkKey) && !message.includes(TICKET_TOKEN) ? mentioned[0] : undefined;

  const invalid =
    (action === "create_ticket" || action === "add_to_ideas") && !draft.title.trim()
      ? "Add a title."
      : action === "link_to_ticket" && !linkKey
        ? "Choose a ticket."
        : action === "ask_tester" && !question.trim()
          ? "Write the question."
          : action !== "ask_tester" && !message.trim()
            ? "Write the message."
            : null;

  function submit() {
    if (invalid || pending) return;
    const testerMessage = stored(message, tokenFor(action));
    // A title is one line, even if a pasted one had line breaks.
    const title = draft.title.replace(/\s*\n\s*/g, " ").trim();
    let decision: DecisionInput;
    switch (action) {
      case "create_ticket":
        decision = { action, draft: { ...draft, title }, testerMessage };
        break;
      case "add_to_ideas":
        decision = { action, draft: { title, summary: draft.summary }, testerMessage };
        break;
      case "link_to_ticket":
        decision = { action, ticketKey: linkKey, relation, testerMessage };
        break;
      case "ask_tester":
        decision = { action, question };
        break;
      default:
        decision = { action, testerMessage };
    }
    startTransition(async () => {
      setError(null);
      const r = await decideAction(item.id, decision);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      const what =
        action === "ask_tester"
          ? `Question sent to ${name}.`
          : r.data.ticketKey
            ? `${item.ref} → ${r.data.ticketKey}. ${name} has been told.`
            : `${item.ref} closed. ${name} has been told.`;
      // Links to both sides of the decision: what the tester sees, and the ticket the developers get.
      const links = [
        ...(r.data.ticketKey ? [{ href: `/tickets/${r.data.ticketKey}`, label: `Open ${r.data.ticketKey}` }] : []),
        ...(item.tester
          ? [
              {
                href: `/tester?as=${item.tester.id}`,
                label: action === "ask_tester" ? `Demo: reply as ${name}` : `See what ${name} sees`,
              },
            ]
          : []),
      ];
      onDecided({ text: matchesAi ? what : `${what} Recorded as a change to the AI suggestion.`, links });
    });
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement;
      if (el.closest("input, textarea, select, [contenteditable], [role='listbox']")) return;
      // While the guided tour runs, no key decides anything (it stops every key too; this is the second lock).
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat || document.documentElement.dataset.tour) return;
      if (e.key === "a") {
        if (Date.now() - openedAt.current >= APPROVE_GUARD_MS) submit();
      } else if (/^[1-6]$/.test(e.key)) choose(ACTIONS[Number(e.key) - 1]);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // The approve button says what it will do, so one click is never a surprise.
  const doing = (() => {
    switch (action) {
      case "create_ticket":
        return "new ticket";
      case "link_to_ticket":
        return linkKey ? `add to ${linkKey}` : "add to a ticket";
      case "add_to_ideas":
        return "new idea";
      case "ask_tester":
        return "send question";
      case "answer":
        return "explain & close";
      case "acknowledge":
        return "thank & close";
    }
  })();
  const approveText = `${matchesAi ? "Approve" : "Save"}: ${doing}`;
  const approveLabel = pending ? "Saving…" : approveText;
  // Said under the decision only when it matters: what is missing, or that the choice differs from the AI's.
  const status = invalid ?? (matchesAi ? null : "Changed from the AI · recorded.");
  const Name = item.tester ? name : "The tester";
  const reader = item.tester ? `${name}, the tester, will read` : "The tester will read";
  const steps = draft.steps_to_reproduce.filter((st) => st.trim());
  // With nothing to show yet, the fields stay open.
  const forced =
    (action === "link_to_ticket" && !chosen) ||
    (action === "ask_tester" && !question.trim()) ||
    ((action === "create_ticket" || action === "add_to_ideas") && !draft.title.trim());
  const showFields = editing || forced;
  const showMessageField = editingMessage || !message.trim();
  const isIdea = chosen?.kind === "idea";

  const caption = (() => {
    switch (action) {
      case "create_ticket":
        return "The ticket you will create";
      case "link_to_ticket":
        return isIdea ? "The idea this report joins" : "The ticket this report joins";
      case "add_to_ideas":
        return "The idea you will keep";
      case "ask_tester":
        return `The question ${Name} will get`;
      default:
        return "No ticket";
    }
  })();
  const canEdit = action !== "answer" && action !== "acknowledge";

  const relationControl = (
    <Segmented
      legend="How it relates"
      hideLegend
      name="relation"
      value={relation}
      onChange={setRelation}
      options={[
        // Worded like the buckets: a bug ticket takes the same bug or another symptom of it.
        { value: "exact_duplicate", label: isIdea ? "Same idea" : "Same bug" },
        { value: "different_aspect", label: isIdea ? "Related idea" : "Other symptom" },
      ]}
    />
  );

  return (
    <>
      <section
        aria-label="Your decision"
        data-tour="decision"
        className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-box-line bg-white shadow-box"
      >
        <BoxHeader
          icon={<CheckCircle />}
          title="Your decision"
          // The one rule, where the decision is made: a person decides each report. A phone has no room for it.
          end={<span className="text-meta text-slate-600 max-sm:hidden">One report at a time. No approve-all.</span>}
        />
        {/* Room above the first row for the AI mark on the suggested choice. */}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-3.5 pb-3">
          <div role="radiogroup" aria-label="What happens to this report" className="grid gap-1.5">
            {ACTION_GROUPS.map((g) => (
              <div key={g.id} className="grid items-center gap-1 sm:grid-cols-[4.75rem_minmax(0,1fr)] sm:gap-2">
                <p className="text-meta font-medium text-slate-800">{g.short}</p>
                <div className="grid grid-cols-3 gap-1.5">
                  {g.actions.map((act) => {
                    const on = action === act;
                    // Keys 1-6 choose too; the number is only in the hint, as on the screen it reads as a step.
                    const key = ACTIONS.indexOf(act) + 1;
                    return (
                      <Tip key={act} text={`${ACTION_HINT[act](name)} (key ${key})`}>
                        <button
                          role="radio"
                          aria-checked={on}
                          onClick={() => choose(act)}
                          className={`relative flex min-h-9 items-center justify-center gap-1.5 rounded-md border px-1.5 py-1 text-[13.5px] leading-tight sm:whitespace-nowrap ${
                            on
                              ? "border-accent bg-white text-accent-fill inset-ring inset-ring-accent"
                              : "border-slate-300 bg-white text-slate-800 hover:border-slate-400 hover:bg-slate-50"
                          }`}
                        >
                          {ACTION_LABEL[act]}
                          {act === a.suggested_action && (
                            <span className="absolute -top-2 right-1 rounded border border-accent/40 bg-white px-1 text-[10px] leading-3.5 font-semibold text-accent">
                              AI<span className="sr-only">&apos;s suggestion</span>
                            </span>
                          )}
                        </button>
                      </Tip>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {/* What approving will create or send, as it will look. */}
          <div className="mt-3">
            <p className="mb-1.5 flex items-baseline justify-between text-xs font-medium text-slate-500">
              <span>{caption}</span>
              {canEdit && (!forced || editing) && (
                <button onClick={() => setEditing(!editing)} className="font-medium text-accent hover:underline">
                  {editing ? "Done" : "Edit"}
                </button>
              )}
            </p>

            {action === "create_ticket" &&
              (showFields ? (
                <TicketFields draft={draft} setDraft={setDraft} bug />
              ) : (
                <div className={CARD}>
                  <p className="flex flex-wrap items-center gap-x-2 text-xs text-slate-600">
                    <span className="font-mono text-[12.5px] text-slate-900">{nextBug}</span>
                    <Severity value={draft.severity ?? "medium"} />
                    <span>· for the developers</span>
                  </p>
                  <p className="mt-1 text-[15px] leading-[1.3125rem] font-semibold text-slate-900">{draft.title}</p>
                  {draft.summary && <p className="mt-1 leading-5">{draft.summary}</p>}
                  {steps.length > 0 && (
                    <ol className="mt-1 list-decimal pl-5 leading-5 marker:text-slate-500">
                      {steps.map((st, i) => (
                        <li key={i}>{st}</li>
                      ))}
                    </ol>
                  )}
                  {(draft.expected || draft.actual) && (
                    <div className="mt-2 grid grid-cols-2 gap-2 text-[13px] leading-[1.125rem]">
                      <div className="rounded-md bg-slate-50 px-2 py-1.5">
                        <span className="block text-[11.5px] font-medium text-slate-500">Expected</span>
                        {draft.expected}
                      </div>
                      <div className="rounded-md bg-slate-50 px-2 py-1.5">
                        <span className="block text-[11.5px] font-medium text-slate-500">Actual</span>
                        {draft.actual}
                      </div>
                    </div>
                  )}
                </div>
              ))}

            {action === "link_to_ticket" &&
              (showFields || !chosen ? (
                <div className="grid gap-2 rounded-md bg-slate-50 p-2 text-sm">
                  <Row label="Ticket" wraps={false}>
                    <Select
                      label="Ticket"
                      hideLabel
                      value={linkKey || null}
                      onChange={chooseTicket}
                      placeholder="Choose a ticket…"
                      options={[...tickets]
                        .filter((t) => t.status !== "wont_fix")
                        .sort((x, y) => Number(y.key === aiTarget) - Number(x.key === aiTarget))
                        .map((t) => ({
                          value: t.key,
                          label: `${t.key} ${t.title}`,
                          detail: [
                            t.key === aiTarget ? "AI's choice" : null,
                            t.kind === "idea" ? "Idea" : t.severity ? SEVERITY_LABEL[t.severity] : null,
                            TICKET_STATUS_LABEL[t.status],
                            `${t.reports} report${t.reports === 1 ? "" : "s"}`,
                          ]
                            .filter(Boolean)
                            .join(" · "),
                        }))}
                    />
                  </Row>
                  <Row label="How" wraps={false}>
                    {relationControl}
                  </Row>
                </div>
              ) : (
                <div className={CARD}>
                  <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-slate-600">
                    <Link
                      href={`/tickets/${chosen.key}`}
                      className="font-mono text-[12.5px] text-slate-900 hover:text-accent hover:underline"
                    >
                      {chosen.key}
                    </Link>
                    <span>
                      · {TICKET_STATUS_LABEL[chosen.status]}
                      {chosen.assignee ? ` · ${chosen.assignee}` : ""}
                      {chosen.origin === "known_issue" ? " · known before testing" : ""}
                    </span>
                  </p>
                  <p className="mt-1 text-[15px] leading-[1.3125rem] font-semibold text-slate-900">{chosen.title}</p>
                  {chosen.summary && <p className="mt-1 line-clamp-3 leading-5">{chosen.summary}</p>}
                  {chosen.reports > 0 && (
                    <div className="mt-2 border-t border-slate-100 pt-1.5">
                      <p className="text-[11.5px] font-medium text-slate-500">
                        Already on it: {chosen.reports} report{chosen.reports === 1 ? "" : "s"} from {chosen.testers} tester
                        {chosen.testers === 1 ? "" : "s"}
                      </p>
                      {chosen.quotes.slice(0, 1).map((q, i) => (
                        <p key={i} className="mt-0.5 line-clamp-1 text-[13px] leading-[1.125rem] text-slate-700">
                          &ldquo;{q}&rdquo;
                        </p>
                      ))}
                    </div>
                  )}
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-meta">
                    <span className="text-slate-600">How it relates</span>
                    {relationControl}
                  </div>
                </div>
              ))}

            {action === "add_to_ideas" &&
              (showFields ? (
                <TicketFields draft={draft} setDraft={setDraft} />
              ) : (
                <div className={CARD}>
                  <p className="text-xs text-slate-600">
                    <span className="font-mono text-[12.5px] text-slate-900">{nextIdea}</span> · ideas backlog · for the
                    product team
                  </p>
                  <p className="mt-1 text-[15px] leading-[1.3125rem] font-semibold text-slate-900">{draft.title}</p>
                  {draft.summary && <p className="mt-1 leading-5">{draft.summary}</p>}
                </div>
              ))}

            {action === "ask_tester" && (
              <>
                {showFields ? (
                  <TextBox
                    lines={4}
                    aria-label={`The question ${Name} will get`}
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    rows={2}
                  />
                ) : (
                  <div className={BUBBLE}>
                    <span className="block text-xs text-slate-600">
                      {manager ? `${manager.name}, UAT manager, asks` : "The UAT manager asks"}
                    </span>
                    {question}
                  </div>
                )}
                <NextSteps
                  steps={[
                    `${Name} gets the question`,
                    `${Name} answers in a line`,
                    "The AI reviews it again, then it comes back here",
                  ]}
                />
              </>
            )}

            {(action === "answer" || action === "acknowledge") && (
              <NextSteps
                steps={[
                  action === "answer" ? `${Name} gets your explanation, below` : `${Name} gets a thank-you, below`,
                  action === "answer" ? "The report closes, explained" : "The report closes: nothing to fix",
                  `${Name} sees it under Your reports`,
                ]}
              />
            )}
          </div>
        </div>

        <div
          className={`grid gap-2 border-t border-slate-200 bg-slate-50 px-4 py-2.5 text-sm ${action === "ask_tester" && !status && !otherTicket && !error ? "max-lg:hidden" : ""}`}
        >
          {action !== "ask_tester" &&
            (showMessageField ? (
              <div className="grid gap-1">
                <p className="flex items-baseline justify-between text-meta">
                  <label htmlFor={`message-${item.id}`} className="text-slate-600">
                    {reader}
                  </label>
                  {message.trim() && (
                    <button onClick={() => setEditingMessage(false)} className="font-medium text-accent hover:underline">
                      Done
                    </button>
                  )}
                </p>
                <TextBox
                  lines={4}
                  id={`message-${item.id}`}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  autoFocus={editingMessage}
                  rows={2}
                />
              </div>
            ) : (
              <div className={BUBBLE}>
                <span className="flex items-baseline justify-between text-xs text-slate-600">
                  <span>{reader}</span>
                  <button onClick={() => setEditingMessage(true)} className="font-medium text-accent hover:underline">
                    Edit
                  </button>
                </span>
                {message}
              </div>
            ))}
          {otherTicket && (
            <p className="text-meta text-amber-800">
              Check the message: it mentions {otherTicket}, not {linkKey}.
            </p>
          )}
          {error && <p className="text-red-700">{error}</p>}
          <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 ${status ? "" : "max-lg:hidden"}`}>
            <button onClick={submit} disabled={!!invalid || pending} className={`${button("primary")} max-lg:hidden`}>
              {/* Keeps its width while saving: it is under the pointer. */}
              <BusyLabel busy={pending} busyText="Saving…">
                {approveText}
                <Kbd>A</Kbd>
              </BusyLabel>
            </button>
            {/* Two short lines fit in the buttons' height, so the row never grows when the note appears. */}
            <span className={`min-w-0 flex-1 text-meta leading-4 ${invalid ? "text-slate-500" : "text-amber-900"}`}>{status}</span>
            <button onClick={() => onMove(1)} className="text-slate-600 hover:text-slate-900 max-lg:hidden">
              Skip for now <Kbd>J</Kbd>
            </button>
          </div>
        </div>
      </section>

      {/* Below a wide screen the decision is far down the page: Approve and Skip stay at the bottom of the screen
          (and only there). `data-approve-bar` tells globals.css to leave room for the bar under the page. */}
      <div
        data-approve-bar
        className="fixed inset-x-0 bottom-0 z-40 flex items-center gap-2.5 border-t border-slate-200 bg-white px-4 pt-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] shadow-[0_-6px_20px_rgba(15,23,42,0.08)] lg:hidden">
        <button onClick={submit} disabled={!!invalid || pending} className={`${button("primary")} min-w-0 flex-1`}>
          <span className="truncate">{approveLabel}</span>
        </button>
        <button onClick={() => onMove(1)} className={button("secondary")}>
          Skip for now
        </button>
      </div>
    </>
  );
}

/** A card showing what a decision will create: a ticket, the ticket a report joins, or an idea. */
const CARD =
  "rounded-lg border border-box-line bg-white px-3 py-2.5 text-[13.5px] text-slate-800 shadow-[0_1px_2px_rgba(15,23,42,0.05)]";

/** A message as the person will read it. */
const BUBBLE = "rounded-[0.625rem] border border-accent/20 bg-accent-soft px-3 py-2 text-sm leading-[1.3125rem] text-slate-900";

/** The fields of a new ticket, or of a new idea (title and summary only). */
function TicketFields({
  draft,
  setDraft,
  bug = false,
}: {
  draft: TicketDraft;
  setDraft: (d: TicketDraft) => void;
  bug?: boolean;
}) {
  return (
    <div
      role="group"
      aria-label={bug ? "Ticket for the developers" : "Idea for the product team"}
      className="grid gap-1.5 rounded-md bg-slate-50 p-2 text-sm"
    >
      <Row label="Title">
        {/* Two lines, so a long title shows in full; Enter does not start a new line. */}
        <TextBox
          lines={2}
          value={draft.title}
          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.preventDefault();
          }}
          rows={2}
        />
      </Row>
      {bug && (
        <Row label="Severity" wraps={false}>
          <Segmented
            legend="Severity"
            hideLegend
            name="severity"
            value={draft.severity ?? "medium"}
            onChange={(v: SeverityLevel) => setDraft({ ...draft, severity: v })}
            options={(["low", "medium", "high", "critical"] as const).map((s) => ({ value: s, label: SEVERITY_LABEL[s] }))}
          />
        </Row>
      )}
      <Row label="Summary">
        <TextBox lines={2} value={draft.summary} onChange={(e) => setDraft({ ...draft, summary: e.target.value })} rows={2} />
      </Row>
      {bug && (
        <>
          <Row label="Steps" hint="one per line">
            <TextBox
              lines={3}
              value={draft.steps_to_reproduce.join("\n")}
              onChange={(e) => setDraft({ ...draft, steps_to_reproduce: e.target.value.split("\n") })}
              rows={3}
            />
          </Row>
          <div className="grid grid-cols-2 items-start gap-1 sm:grid-cols-[4.5rem_minmax(0,1fr)_minmax(0,1fr)] sm:gap-2">
            <span aria-hidden className="col-span-2 text-meta text-slate-600 sm:col-span-1 sm:pt-1.5">
              Expected · Actual
            </span>
            <TextBox
              lines={2}
              aria-label="Expected"
              value={draft.expected}
              onChange={(e) => setDraft({ ...draft, expected: e.target.value })}
              rows={2}
            />
            <TextBox
              lines={2}
              aria-label="Actual"
              value={draft.actual}
              onChange={(e) => setDraft({ ...draft, actual: e.target.value })}
              rows={2}
            />
          </div>
        </>
      )}
    </div>
  );
}

/** What happens next, in order; the first step is what approving does. */
function NextSteps({ steps }: { steps: string[] }) {
  return (
    <ol className="mt-3 grid gap-2">
      {steps.map((st, i) => (
        <li key={i} className="flex items-center gap-2.5 text-[13.5px] text-slate-800">
          <span
            aria-hidden
            className={`flex h-[1.375rem] w-[1.375rem] shrink-0 items-center justify-center rounded-full border text-[11.5px] ${
              i === 0 ? "border-accent-fill bg-accent-fill text-white" : "border-slate-300 bg-white text-slate-600"
            }`}
          >
            {i + 1}
          </span>
          {st}
        </li>
      ))}
    </ol>
  );
}

/** A form row with its label on the left, which keeps the decision short enough for one screen. */
function Row({
  label,
  hint,
  wraps = true,
  children,
}: {
  label: string;
  hint?: string;
  /** False when the control names itself (a radio group or a designed select). */
  wraps?: boolean;
  children: React.ReactNode;
}) {
  const Tag = wraps ? "label" : "div";
  return (
    <Tag className="grid items-start gap-1 sm:grid-cols-[4.5rem_minmax(0,1fr)] sm:gap-2">
      <span aria-hidden={!wraps} className="text-meta text-slate-600 sm:pt-1.5">
        {label}
        {hint && <span className="block text-[11px] leading-3 text-slate-500">{hint}</span>}
      </span>
      <div className="min-w-0">{children}</div>
    </Tag>
  );
}

/** The key on a button, hidden on a phone, which has no keyboard. */
function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-slate-300 bg-white px-1 font-sans text-[11px] leading-4 text-slate-600 max-sm:hidden">
      {children}
    </kbd>
  );
}
