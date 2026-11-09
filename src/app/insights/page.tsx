import Link from "next/link";
import { Tip } from "@/components/ui/tip";
import { AiTag } from "@/components/ui/ai-tag";
import { BoxHeader } from "@/components/ui/box-header";
import { Clock, NumberedList } from "@/components/ui/icons";
import { InfoTip } from "@/components/ui/info-tip";
import { calibrationInfo, holdoutInfo, type CalibrationBin } from "@/lib/ai/calibration";
import { ensureFreshDemo } from "@/lib/demo";
import { retestTally } from "@/lib/labels";
import { getOverview } from "@/lib/queries";
import { fixState, notYetRetested } from "@/lib/ticket-work";

/**
 * Insights (Manager → Insights): the cycle in one sentence, four headline figures, reports day by day, problems per
 * test script, and how sure is sure. Counts come from the database (getOverview). The AI's accuracy was measured before
 * the demo and is read from data/calibration.json (npm run eval, 57 labelled sample reports, also used to tune the AI)
 * and data/holdout.json (npm run eval:holdout, 15 reports never used for tuning); "In this demo" sets the manager's
 * decisions against the AI's suggestions in the same confidence ranges. The page only reads, after the shared demo's
 * idle check.
 *
 * StatTile: a headline figure.
 * Box: a box with the shared title band.
 * Bar: one bar of Where the problems are.
 * withQuietSpans: two or more days without reports become one line.
 * DayByDay: the day-by-day table.
 */

export const dynamic = "force-dynamic";
export const metadata = { title: "Insights" };

/** Outcomes the tester has been told: the report became or joined a ticket or an idea, or was explained or thanked. */
const TOLD = ["linked", "ticketed", "idea", "answered", "acknowledged"];

/** Fewer labelled cases than this in a range is too few to quote a rate (the review screen uses the same rule). */
const MIN_CASES = 5;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * What each report became, for the day-by-day table: one column each, in a fixed order, numbers only. Pointing at a
 * column's name says what it holds.
 */
const DAY_KINDS = [
  { id: "new", label: "New bug", title: "Became a new bug ticket." },
  { id: "joined", label: "Added", title: "Joined a ticket that already existed: same bug, other symptom, or known before testing." },
  { id: "idea", label: "Idea", title: "Went to the ideas backlog, or joined an idea." },
  { id: "reply", label: "No ticket", title: "Explained or thanked; no ticket." },
  { id: "waiting", label: "Waiting", title: "For review, or for the tester's answer." },
] as const;
type DayKind = (typeof DAY_KINDS)[number]["id"];

/** The Day by day column a report counts in; new, awaiting_review and needs_info all count as waiting. */
function dayKind(status: string, ticketKind: string | undefined): DayKind {
  if (status === "ticketed") return "new";
  // A report that joins an idea someone already had is an idea, not a bug report added to a ticket.
  if (status === "linked") return ticketKind === "idea" ? "idea" : "joined";
  if (status === "idea") return "idea";
  if (status === "answered" || status === "acknowledged") return "reply";
  return "waiting";
}

/** The day a time falls on in London, as YYYY-MM-DD (en-CA writes it that way), so days sort and compare as text. */
const dayKey = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "Europe/London" });
/**
 * Up to this many days, Day by day shows the quiet days too (two or more in a row share a line); a longer span shows
 * only days with reports.
 */
const MAX_DAYS = 31;
const nextDay = (key: string) => new Date(Date.parse(`${key}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
/** A day key as the table shows it, "Tue 3 Nov"; read in UTC, since the key is already the London day. */
const dayLabel = (key: string) =>
  new Date(`${key}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const range = (b: CalibrationBin) => `${Math.round(b.min * 100)}–${Math.round(b.max * 100)}%`;
/** A figure with a hover that says more: a dotted line under it shows there is something to point at. */
const HINT = "cursor-help underline decoration-slate-400 decoration-dotted underline-offset-[3px]";

/** The demo's counts are all worked out here from one getOverview() read, so the sentence, tiles and boxes agree. */
export default async function InsightsPage() {
  await ensureFreshDemo();
  const o = await getOverview();
  const reports = o.feedback.length;
  const cycleTickets = o.tickets.filter((t) => t.origin === "cycle");
  const bugs = cycleTickets.filter((t) => t.kind === "bug").length;
  const ideas = cycleTickets.filter((t) => t.kind === "idea").length;
  const count = (statuses: string[]) => o.feedback.filter((f) => statuses.includes(f.status)).length;
  const kindOfTicket = new Map(o.tickets.map((t) => [t.id, t.kind]));
  const undecided = count(["new", "awaiting_review"]);
  const questions = count(["needs_info"]);
  const told = count(TOLD);
  // Reports added to a bug ticket that already existed (one joining an idea counts with the ideas, as in Day by day).
  const repeats = o.feedback.filter(
    (f) => (f.relation === "exact_duplicate" || f.relation === "different_aspect") && kindOfTicket.get(f.ticket_id ?? "") !== "idea",
  ).length;
  // Bugs marked fixed, and the retest answers since each was fixed: one per tester, and who has not answered yet.
  const fixed = o.tickets
    .filter((t) => t.kind === "bug" && t.status === "fixed")
    .map((t) => ({ fix: fixState(o.events.filter((e) => e.ticket_id === t.id)), reports: o.feedback.filter((f) => f.ticket_id === t.id) }));
  const retest = retestTally(
    fixed.reduce((n, t) => n + (t.fix?.passed.length ?? 0), 0),
    fixed.reduce((n, t) => n + (t.fix?.failed.length ?? 0), 0),
    fixed.reduce((n, t) => n + notYetRetested(t.fix, t.reports), 0),
  );

  // Where the problems are: reports per test script, and the tickets they ended up on.
  const byScript = o.scripts
    .map((s) => {
      const mine = o.feedback.filter((f) => f.step_id?.startsWith(`${s.id}.`));
      const perTicket = o.tickets
        .map((t) => ({ key: t.key, title: t.title, n: mine.filter((f) => f.ticket_id === t.id).length }))
        .filter((x) => x.n > 0)
        .sort((a, b) => b.n - a.n);
      return { label: `${s.id} ${s.title}`, value: mine.length, perTicket };
    })
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value);
  const general = o.feedback.filter((f) => !f.step_id).length;

  // Day by day: when reports came in, and what each became.
  const reportDays = [...new Set(o.feedback.map((f) => dayKey(f.submitted_at)))].sort();
  // Every day from the first report to the last, quiet ones included, so a gap in testing shows; over a span longer
  // than a test cycle (an imported sheet with odd dates), only the days with reports.
  const span = reportDays.length ? (Date.parse(reportDays.at(-1)!) - Date.parse(reportDays[0])) / 86_400_000 + 1 : 0;
  const dayKeys: string[] = [];
  if (span > 0 && span <= MAX_DAYS) for (let d = reportDays[0]; d <= reportDays.at(-1)!; d = nextDay(d)) dayKeys.push(d);
  else dayKeys.push(...reportDays);
  const days = dayKeys.map((key) => {
    const mine = o.feedback.filter((f) => dayKey(f.submitted_at) === key);
    const counts = Object.fromEntries(
      DAY_KINDS.map((k) => [k.id, mine.filter((f) => dayKind(f.status, kindOfTicket.get(f.ticket_id ?? "")) === k.id).length]),
    ) as Record<DayKind, number>;
    return { key, total: mine.length, counts };
  });
  const busiest = days.reduce<(typeof days)[number] | null>((a, d) => (!a || d.total > a.total ? d : a), null);
  const dayTotals = Object.fromEntries(DAY_KINDS.map((k) => [k.id, days.reduce((n, d) => n + d.counts[k.id], 0)])) as Record<DayKind, number>;
  // Each total's share, and what it is made of, for a hover on the Total row.
  const share = (n: number) => `${n} of ${reports} (${reports ? Math.round((n / reports) * 100) : 0}%)`;
  const totalTitles: Record<DayKind, string> = {
    new: share(dayTotals.new),
    joined: share(dayTotals.joined),
    idea: share(dayTotals.idea),
    reply: `${share(dayTotals.reply)}: ${count(["answered"])} explained, ${count(["acknowledged"])} thanked`,
    waiting: `${share(dayTotals.waiting)}: ${undecided} for review, ${questions} for the tester`,
  };
  const dayEnd = days.length
    ? `${plural(days.length, "day")}${days.length > 1 && busiest ? ` · busiest ${dayLabel(busiest.key)} (${busiest.total})` : ""}`
    : "";

  // AI suggestions against people's decisions, in the same confidence ranges that were measured.
  const withAi = o.decisions.filter((d) => d.ai_action && d.analysis_id);
  const agreed = withAi.filter((d) => !d.overridden).length;
  const byHand = o.decisions.length - withAi.length;
  const calibration = calibrationInfo();
  const holdout = holdoutInfo();
  const bins = [...calibration.bins].sort((a, b) => b.min - a.min);
  const inBin = (b: CalibrationBin, c: number) => c >= b.min && (c < b.max || (b.max >= 1 && c <= 1));
  const live = bins.map((b) => {
    const rows = withAi.filter((d) => inBin(b, o.confidenceByAnalysis.get(d.analysis_id!) ?? 0));
    return { bin: b, decided: rows.length, agreed: rows.filter((d) => !d.overridden).length };
  });
  const measured = bins.reduce((sum, b) => ({ n: sum.n + b.n, correct: sum.correct + b.correct }), { n: 0, correct: 0 });

  const addedNote = repeats === 1 ? "1 added to an existing ticket" : `${repeats} added to existing tickets`;
  // What the (i) of Day by day says: the columns, and each total's share, readable without pointing at a number.
  const dayTip =
    "Every report ends with an outcome the tester sees. When reports came in, and what each became. Added: joined a ticket that " +
    "already existed (same bug, other symptom, or known before testing). No ticket: explained or thanked. Waiting: for review or " +
    `for the tester's answer.${reports ? ` Totals: ${DAY_KINDS.map((k) => `${k.label} ${totalTitles[k.id]}`).join("; ")}.` : ""}`;

  // The cycle in one sentence, in the words the rest of the page uses; the boxes below hold the detail.
  const summary = reports
    ? `${plural(reports, "report")} this cycle: ${plural(bugs, "new bug ticket")}, ${plural(ideas, "idea")} and ${addedNote}. ` +
      `${told} told the outcome; ${undecided} ${undecided === 1 ? "waits" : "wait"} for review${questions ? ` and ${questions} for the tester` : ""}.` +
      (fixed.length ? ` ${plural(fixed.length, "bug")} fixed; retest: ${retest}.` : "")
    : "No reports yet.";

  return (
    <div className="app-container flex flex-col gap-3 py-5">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h1 className="text-title font-semibold text-slate-900">Insights</h1>
        <p className="text-meta text-slate-600">{summary}</p>
      </div>

      {/* Two by two on a phone, a row of four from a laptop. */}
      <section aria-label="Headline numbers" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Reports received" value={reports} note={addedNote} />
        <StatTile label="New bug tickets" value={bugs} note={`plus ${plural(ideas, "idea")}`} />
        <StatTile
          label="Waiting for review"
          value={undecided}
          note={
            <Link href="/review" className="text-accent hover:underline">
              Open Review
            </Link>
          }
        />
        {/* Always the measured figure: what the manager kept in this demo is under "How sure is sure?". */}
        <StatTile
          label="AI right on sample reports"
          value={`${measured.correct}/${measured.n}`}
          note={`used to tune the AI · ${holdout.correct}/${holdout.n} unseen`}
        />
      </section>

      <div className="grid gap-3 lg:grid-cols-2">
        <Box
          id="days"
          title="Day by day"
          icon={<Clock />}
          end={
            <span className="flex items-center gap-2 text-meta text-slate-500">
              {dayEnd}
              <InfoTip label="What the columns mean" text={dayTip} />
            </span>
          }
        >
          <DayByDay days={days} totals={dayTotals} totalTitles={totalTitles} />
        </Box>
        <Box id="problems" title="Where the problems are" icon={<NumberedList />} detail="per test script">
          <ul className="flex flex-col gap-1.5">
            {byScript.map((r) => (
              <li key={r.label} className="text-sm">
                <Bar label={r.label} value={r.value} max={byScript[0]?.value ?? 1} />
                {r.perTicket.length > 0 && (
                  <p className="text-meta text-slate-500">
                    {r.perTicket.map((t, i) => (
                      <span key={t.key}>
                        {i > 0 && " · "}
                        <Tip text={`${t.key} · ${t.title} · ${plural(t.n, "report")} from this script`}>
                          <span>
                            <Link href={`/tickets/${t.key}`} className="font-mono text-accent hover:underline">
                              {t.key}
                            </Link>
                          </span>
                        </Tip>{" "}
                        ×{t.n}
                      </span>
                    ))}
                  </p>
                )}
              </li>
            ))}
            {general > 0 && (
              <li className="text-sm">
                <Bar label="General feedback, no test step" value={general} max={byScript[0]?.value ?? 1} />
              </li>
            )}
          </ul>
        </Box>
      </div>

      <Box
        id="how-sure"
        tour="how-sure"
        title="How sure is sure?"
        icon={<AiTag />}
        end={<span className="text-meta text-slate-500 max-sm:w-full">If the confidence figure is honest, higher figures are right more often.</span>}
      >
        <div className="grid gap-4 md:grid-cols-2 md:divide-x md:divide-slate-100">
          <div className="md:pr-4">
            <h3 className="text-meta font-medium text-slate-700">
              Measured before the demo: {calibration.dataset} (also used to tune the AI), and {holdout.n} unseen ones
            </h3>
            <dl className="mt-1.5 grid grid-cols-2 gap-2 sm:grid-cols-5">
              {bins.map((b) => (
                <div key={b.min} className="rounded-md bg-slate-50 px-2.5 py-1.5">
                  <dt className="text-meta text-slate-500">{range(b)} sure</dt>
                  <dd className="text-sm tabular-nums text-slate-900">
                    {b.n >= MIN_CASES ? (
                      `${b.correct} of ${b.n} right`
                    ) : b.n === 0 ? (
                      <span className="text-slate-500">no cases</span>
                    ) : (
                      // The count stays visible, so a miss in a small range is not hidden: only no rate is quoted.
                      <Tip reach text={`${plural(b.n, "sample report")} in this range, ${b.correct} right: too few to judge.`}>
                        <span className="text-slate-600">
                          {b.correct} of {b.n}: too few
                        </span>
                      </Tip>
                    )}
                  </dd>
                </div>
              ))}
              <Tip
                reach
                text="Written and labelled by a separate AI agent that never saw the AI's instructions, and never used to tune it. A small set, so no rate is quoted from it."
              >
                <div className="rounded-md px-2.5 py-1.5 ring-1 ring-slate-200">
                  <dt className="text-meta text-slate-500">Unseen reports</dt>
                  <dd className="text-sm tabular-nums text-slate-900">
                    {holdout.correct} of {holdout.n} right
                  </dd>
                </div>
              </Tip>
            </dl>
          </div>
          <div className="md:pl-4">
            <h3 className="text-meta font-medium text-slate-700">
              {withAi.length ? (
                `In this demo: the manager kept ${agreed} of ${plural(withAi.length, "AI suggestion")}`
              ) : (
                <>
                  In this demo: how often the manager kept the AI&apos;s suggestion{" "}
                  {(() => {
                    const noneYet = (
                      <span className="font-normal text-slate-500">
                        · none yet: decide a few in{" "}
                        <Link href="/review" className="text-accent hover:underline">
                          Review
                        </Link>
                      </span>
                    );
                    return byHand ? (
                      <Tip
                        reach
                        text={`${byHand === 1 ? "The 1 earlier decision was" : `The ${byHand} earlier decisions were`} made by hand, before AI suggestions were switched on.`}
                      >
                        {noneYet}
                      </Tip>
                    ) : (
                      noneYet
                    );
                  })()}
                </>
              )}
            </h3>
            {/* The four ranges are always there, so the box keeps its size once decisions come in. */}
            <dl className="mt-1.5 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {live.map((r) => (
                <div key={r.bin.min} className="rounded-md bg-slate-50 px-2.5 py-1.5">
                  <dt className="text-meta text-slate-500">{range(r.bin)} sure</dt>
                  <dd className="text-sm tabular-nums text-slate-900">
                    {r.decided ? `${r.agreed} of ${r.decided} kept` : <span className="text-slate-500">none yet</span>}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </Box>
    </div>
  );
}

/** A headline figure: the number above its label on a phone, beside it from a small tablet up. */
function StatTile({ label, value, note }: { label: string; value: number | string; note?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-0.5 rounded-lg border border-box-line bg-white shadow-box px-4 py-3 sm:flex-row sm:items-center sm:gap-3">
      <p className="text-3xl font-semibold tabular-nums text-slate-900">{value}</p>
      <div className="min-w-0">
        <p className="text-sm text-slate-700">{label}</p>
        {note && <p className="text-meta text-slate-500">{note}</p>}
      </div>
    </div>
  );
}

/** A box with the shared title band; a few words after the title, or at the band's end. */
function Box({
  id,
  tour,
  title,
  icon,
  detail,
  end,
  children,
}: {
  id: string;
  /** What the guided tour points at (components/tour). */
  tour?: string;
  title: string;
  icon: React.ReactNode;
  detail?: string;
  end?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section id={id} data-tour={tour} aria-labelledby={`${id}-title`} className="min-w-0 overflow-hidden rounded-lg border border-box-line bg-white shadow-box">
      <BoxHeader icon={icon} title={title} titleId={`${id}-title`} detail={detail && <span className="text-meta text-slate-500">{detail}</span>} end={end} />
      <div className="px-4 py-3">{children}</div>
    </section>
  );
}

/**
 * One ranked bar in one hue, labelled with its value. On a phone the label and value share a line with a thin bar
 * under them; from a small tablet up the bar sits between them.
 */
function Bar({ label, value, max }: { label: string; value: number; max: number }) {
  return (
    <div
      className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-[3px] sm:grid-cols-[minmax(0,1fr)_6rem_4.5rem]"
    >
      <span className="leading-snug text-slate-700">{label}</span>
      <div aria-hidden className="col-span-2 h-1.5 rounded-full bg-slate-100 max-sm:order-last sm:col-span-1 sm:h-2">
        <div
          className="h-full rounded-full bg-accent-fill/85"
          style={{ width: `${value === 0 ? 0 : Math.max(4, (value / Math.max(1, max)) * 100)}%` }}
        />
      </div>
      <span className="text-right tabular-nums text-slate-900">{value}</span>
    </div>
  );
}

type Day = { key: string; total: number; counts: Record<DayKind, number> };

/** Two or more quiet days in a row become one line, so a gap in testing shows without filling the chart. */
function withQuietSpans(days: Day[]): (Day | { quiet: true; from: string; to: string })[] {
  const out: (Day | { quiet: true; from: string; to: string })[] = [];
  for (let i = 0; i < days.length; ) {
    let j = i;
    while (j < days.length && days[j].total === 0) j++;
    if (j - i >= 2) {
      out.push({ quiet: true, from: days[i].key, to: days[j - 1].key });
      i = j;
    } else {
      out.push(days[i]);
      i++;
    }
  }
  return out;
}

/**
 * One row per day: how many reports came in (a bar in the one accent colour, and the number) and what they became, as
 * numbers in columns. No colour code to learn; a column's name, and each total, says more when pointed at.
 */
function DayByDay({ days, totals, totalTitles }: { days: Day[]; totals: Record<DayKind, number>; totalTitles: Record<DayKind, string> }) {
  const max = Math.max(1, ...days.map((d) => d.total));
  const rows = withQuietSpans(days);
  const num = (n: number) => (n ? n : <span className="text-slate-300">–</span>);
  const total = days.reduce((n, d) => n + d.total, 0);
  return (
    // On a narrow phone the table scrolls by itself rather than widening the page.
    <div className="overflow-x-auto text-sm">
      <table className="w-full text-left text-meta tabular-nums">
        <caption className="sr-only">Reports per day, and what each became</caption>
        <thead className="text-slate-500">
          <tr>
            <th scope="col" className="py-1 pr-2 font-medium">
              Day
            </th>
            <th scope="col" className="py-1 pr-2 font-medium">
              Reports
            </th>
            {DAY_KINDS.map((k) => (
              <th key={k.id} scope="col" className="py-1 pl-1.5 text-right leading-tight font-medium max-sm:pl-1">
                <Tip text={k.title} reach>
                  <span className={HINT}>{k.label}</span>
                </Tip>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="text-slate-800">
          {rows.map((d) =>
            "quiet" in d ? (
              <tr key={d.from} className="border-t border-slate-100 text-slate-500">
                <td colSpan={2 + DAY_KINDS.length} className="py-1">
                  {dayLabel(d.from)} – {dayLabel(d.to)} · no reports
                </td>
              </tr>
            ) : (
              <tr key={d.key} className="border-t border-slate-100">
                <th scope="row" className="py-1 pr-2 font-normal whitespace-nowrap text-slate-600">
                  {/* On a phone the weekday is left out, so every column fits. */}
                  <span className="max-sm:hidden">{dayLabel(d.key).split(" ")[0]} </span>
                  {dayLabel(d.key).split(" ").slice(1).join(" ")}
                </th>
                <td className="py-1 pr-2">
                  <span className="flex items-center gap-2">
                    <span aria-hidden className="h-2 w-14 shrink-0 rounded-full bg-slate-100 max-sm:hidden">
                      <span
                        className="block h-full rounded-full bg-accent-fill/85"
                        style={{ width: `${d.total ? Math.max(8, (d.total / max) * 100) : 0}%` }}
                      />
                    </span>
                    {d.total}
                  </span>
                </td>
                {DAY_KINDS.map((k) => (
                  <td key={k.id} className="py-1 pl-1.5 text-right">
                    {num(d.counts[k.id])}
                  </td>
                ))}
              </tr>
            ),
          )}
          <tr className="border-t border-slate-300 font-medium">
            <th scope="row" className="py-1 pr-2 text-left font-medium">
              Total
            </th>
            <td className="py-1 pr-2">{total}</td>
            {DAY_KINDS.map((k) => (
              <td key={k.id} className="py-1 pl-1.5 text-right">
                {totals[k.id] ? (
                  <Tip text={totalTitles[k.id]} reach>
                    <span className={HINT}>{totals[k.id]}</span>
                  </Tip>
                ) : (
                  num(0)
                )}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
