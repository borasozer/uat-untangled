import Link from "next/link";
import { TicketStatusBadge } from "@/components/badges";
import { BoxHeader } from "@/components/ui/box-header";
import { Bug, Bulb } from "@/components/ui/icons";
import { Severity } from "@/components/ui/severity";
import { ensureFreshDemo } from "@/lib/demo";
import { retestTally } from "@/lib/labels";
import { getPeople, getTickets } from "@/lib/queries";
import type { Severity as SeverityLevel } from "@/lib/types";

/**
 * Tickets, the developer's list (Developer → Tickets). Bugs come first, in groups: to fix (most urgent first), fixed and
 * waiting for retest, fixed and confirmed by every tester, known before testing, won't fix. The ideas for the product
 * team follow. A row opens the ticket's own page. The page only reads, after the shared demo's idle check.
 */

export const dynamic = "force-dynamic";
export const metadata = { title: "Tickets" };

type Row = Awaited<ReturnType<typeof getTickets>>[number];

const SEVERITY_RANK: Record<SeverityLevel, number> = { critical: 4, high: 3, medium: 2, low: 1 };

/** The columns of both lists, so bugs and ideas line up: severity, key, title, reports, status (with the owner).
 *  Each as narrow as its longest value ("Critical", "4 reports · 4 testers", "In progress · Ravi"), so titles keep one line at 1024 px. */
const COLUMNS = "md:grid-cols-[5.5rem_4.5rem_minmax(0,1fr)_9.5rem_8rem]";
/** A row's title link covers the whole row, so a click anywhere on it opens the ticket; pointing at the row underlines the
 *  title. The key link sits above it and stays its own link. */
const ROW_LINK = "after:absolute after:inset-0 hover:underline group-hover/row:underline";

/** Most urgent first: severity, then how many reports and testers it has. */
function byPriority(a: Row, b: Row): number {
  return (
    (b.severity ? SEVERITY_RANK[b.severity] : 0) - (a.severity ? SEVERITY_RANK[a.severity] : 0) ||
    b.reports - a.reports ||
    b.testers - a.testers ||
    a.key.localeCompare(b.key)
  );
}

/** Only bugs found in this cycle are "to fix"; a known issue stays in its own group, whatever its status. */
export default async function TicketsPage() {
  await ensureFreshDemo();
  const [tickets, people] = await Promise.all([getTickets(), getPeople()]);
  const owner = (id: string | null) => (id ? (people.find((p) => p.id === id)?.name.split(" ")[0] ?? "Someone") : null);
  const bugs = tickets.filter((t) => t.kind === "bug");
  const toFix = bugs.filter((t) => t.origin === "cycle" && (t.status === "open" || t.status === "in_progress")).sort(byPriority);
  const fixedAll = bugs.filter((t) => t.origin === "cycle" && t.status === "fixed").sort(byPriority);
  // Every tester who reported it says it works now: shown apart, but nothing closes by itself.
  const fixed = fixedAll.filter((t) => !t.confirmed);
  const confirmed = fixedAll.filter((t) => t.confirmed);
  const known = bugs.filter((t) => t.origin === "known_issue").sort(byPriority);
  const closed = bugs.filter((t) => t.origin === "cycle" && t.status === "wont_fix").sort(byPriority);
  const ideas = tickets.filter((t) => t.kind === "idea").sort((a, b) => b.reports - a.reports || a.key.localeCompare(b.key));
  const inProgress = toFix.filter((t) => t.status === "in_progress").length;
  // What the "to fix" count holds, in brackets so it does not read as more tickets: "5 to fix (3 high, 1 in progress)".
  // Known issues and ideas are counted in their own titles below.
  const within = [
    ...(["critical", "high"] as const).map((s) => [s, toFix.filter((t) => t.severity === s).length] as const).filter(([, n]) => n > 0).map(([s, n]) => `${n} ${s}`),
    inProgress ? `${inProgress} in progress` : null,
  ].filter(Boolean);
  const summary = [`${toFix.length} to fix${within.length ? ` (${within.join(", ")})` : ""}`, fixedAll.length ? `${fixedAll.length} fixed` : null].filter(Boolean);

  return (
    <div className="app-container flex flex-col gap-5 py-5">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h1 className="text-title font-semibold text-slate-900">Tickets</h1>
        <p className="text-meta text-slate-600">{summary.join(" · ")}</p>
      </div>
      <p className="-mt-3 text-sm text-slate-600">Most urgent first. Testers send reports, not tickets; a person decides what each becomes.</p>

      <section aria-labelledby="bugs" className="overflow-hidden rounded-lg border border-box-line bg-white shadow-box">
        <BoxHeader
          icon={<Bug />}
          titleId="bugs"
          title={
            <>
              Bugs <span className="font-normal text-slate-500">({bugs.length})</span>
            </>
          }
        />
        <BugTable
          owner={owner}
          groups={[
            { title: null, rows: toFix, empty: "No open bugs." },
            { title: "Fixed · waiting for retest", rows: fixed },
            { title: "Fixed · confirmed by every tester", rows: confirmed },
            { title: "Known before testing · new reports join these", rows: known },
            { title: "Won't fix", rows: closed },
          ]}
        />
      </section>

      <section aria-labelledby="ideas" className="overflow-hidden rounded-lg border border-box-line bg-white shadow-box">
        <BoxHeader
          icon={<Bulb />}
          titleId="ideas"
          title={
            <>
              Ideas <span className="font-normal text-slate-500">({ideas.length}) · for the product team</span>
            </>
          }
        />
        {ideas.length === 0 ? (
          <p className="px-4 py-3 text-sm text-slate-500">No ideas yet.</p>
        ) : (
          <ul>
            {ideas.map((t) => (
              <li
                key={t.id}
                className={`group/row relative grid grid-cols-1 gap-y-1 border-t border-slate-100 px-4 py-2.5 text-sm first:border-t-0 hover:bg-slate-50 md:items-baseline md:gap-4 ${COLUMNS}`}
              >
                <span className="max-md:hidden" />
                <Link href={`/tickets/${t.key}`} className="relative z-1 font-mono text-accent hover:underline">
                  {t.key}
                </Link>
                <Link href={`/tickets/${t.key}`} className={`min-w-0 text-slate-900 ${ROW_LINK}`}>
                  {t.title}
                </Link>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 md:contents">
                  <Reports n={t.reports} testers={t.testers} />
                  <span className="max-md:ml-auto">
                    <TicketStatusBadge status={t.status} kind="idea" />
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** The Reports column: "3 reports · 2 testers", or "No reports yet" when no report has joined the ticket. */
function Reports({ n, testers }: { n: number; testers: number }) {
  return (
    <span className="shrink-0 tabular-nums text-slate-700">
      {n === 0 ? (
        <span className="text-slate-500">No reports yet</span>
      ) : (
        <>
          {n} report{n === 1 ? "" : "s"}
          <span className="text-slate-500">
            {" "}
            · {testers} tester{testers === 1 ? "" : "s"}
          </span>
        </>
      )}
    </span>
  );
}

/** Every bug group under one row of column titles. An empty group is left out unless it has an `empty` line to show. */
function BugTable({
  groups,
  owner,
}: {
  groups: { title: string | null; rows: Row[]; empty?: string }[];
  owner: (id: string | null) => string | null;
}) {
  return (
    <div>
      {/* Column titles, on wide screens only: on a phone each row stacks into a small card. */}
      <div className={`hidden gap-4 bg-slate-50 px-4 py-1.5 text-xs font-medium text-slate-500 md:grid ${COLUMNS}`}>
        <span>Severity</span>
        <span>Key</span>
        <span>Title</span>
        <span>Reports</span>
        <span>Status</span>
      </div>
      {groups.map((g) =>
        g.rows.length === 0 && !g.empty ? null : (
          // The bugs still to fix: what the guided tour points at (components/tour).
          <div key={g.title ?? "main"} data-tour={g.title ? undefined : "to-fix"}>
            {g.title && (
              <p className="border-t border-slate-200 bg-slate-50 px-4 py-1.5 text-meta font-medium text-slate-600">{g.title}</p>
            )}
            {g.rows.length === 0 && <p className="border-t border-slate-100 px-4 py-3 text-sm text-slate-500">{g.empty}</p>}
            <ul>
              {g.rows.map((t) => (
                <li
                  key={t.id}
                  className={`group/row relative grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 border-t border-slate-100 px-4 py-2.5 text-sm hover:bg-slate-50 md:items-baseline md:gap-4 ${COLUMNS}`}
                >
                  <Severity value={t.severity} className="max-md:order-2 max-md:justify-self-end" />
                  <Link href={`/tickets/${t.key}`} className="relative z-1 font-mono text-accent hover:underline max-md:order-1">
                    {t.key}
                  </Link>
                  <span className="min-w-0 max-md:order-3 max-md:col-span-2">
                    <Link href={`/tickets/${t.key}`} className={`text-slate-900 ${ROW_LINK}`}>
                      {t.title}
                    </Link>
                    {t.step_id && <span className="ml-2 whitespace-nowrap font-mono text-meta text-slate-500">{t.step_id}</span>}
                    {/* Once every tester has confirmed, the group's title says it all. */}
                    {t.fix && !t.confirmed && (
                      <span className="block text-meta text-slate-600">
                        Retest: {retestTally(t.fix.passed.length, t.fix.failed.length, t.notYet)}
                        {t.fix.failed.length > 0 && <span className="text-red-700"> · needs a look</span>}
                      </span>
                    )}
                  </span>
                  {/* On a phone: reports and status share one line under the title. The owner follows the status
                      ("In progress · Ravi"); with no owner there is nothing to add. */}
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 max-md:order-4 max-md:col-span-2 md:contents">
                    <Reports n={t.reports} testers={t.testers} />
                    <span className="whitespace-nowrap text-slate-700 max-md:ml-auto">
                      <TicketStatusBadge status={t.status} />
                      {owner(t.assignee_id) && <> · {owner(t.assignee_id)}</>}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ),
      )}
    </div>
  );
}
