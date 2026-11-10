import { headers } from "next/headers";
import { Tip } from "@/components/ui/tip";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Pill, TicketStatusBadge } from "@/components/badges";
import { BoxHeader } from "@/components/ui/box-header";
import { Check, ChevronDown, Clock, Cross, Speech } from "@/components/ui/icons";
import { Severity } from "@/components/ui/severity";
import type { Action } from "@/lib/ai/schema";
import { ensureFreshDemo } from "@/lib/demo";
import { ACTION_DONE, ACTION_LABEL, formatDay, formatWhen, relationLabel, retestTally } from "@/lib/labels";
import { countTesters, getTicket } from "@/lib/queries";
import { FIXED_NOTE, REOPENED_NOTE, isConfirmed, notYetRetested } from "@/lib/ticket-work";
import { DevPanel, type Retest } from "./dev-panel";
import { JiraFields, type JiraField } from "./jira-fields";

/**
 * One ticket, for the developer (opened from Tickets; Review, Insights and the tester's reports link here too). The
 * header says where it came from, with the steps to reproduce folded under it; then every tester's report with the
 * decision behind it (and whether the AI's suggestion was kept), and the ticket's history. Beside them: the Developer
 * box (DevPanel, for bugs found in this cycle) and For Jira (JiraFields), filled by jiraFields() below from the same
 * data.
 * The page only reads, after the shared demo's idle check; DevPanel's buttons write, through server actions.
 *
 * EvidenceCard: one tester's report on this ticket, with its decision and, after a fix, a "still broken" retest.
 * testDataOf: the enquiry and test-email numbers the testers mention.
 * jiraFields: the Jira fields as plain text, ready to paste.
 */

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ key: string }> }) {
  return { title: `Ticket ${decodeURIComponent((await params).key)}` };
}

/** A ticket that exists, as getTicket loads it: its reports with testers, the decisions, its history and fix state. */
type Data = NonNullable<Awaited<ReturnType<typeof getTicket>>>;

/** "link_to_ticket:MIA-101" → "Add to MIA-101". */
function aiLabel(key: string): string {
  const [action, target] = key.split(":");
  if (action === "link_to_ticket" && target) return `Add to ${target}`;
  return ACTION_LABEL[action as Action] ?? action;
}

/** The key comes from the address, so it is decoded first; an unknown key shows the 404 page. */
export default async function TicketPage({ params }: { params: Promise<{ key: string }> }) {
  await ensureFreshDemo();
  const { key } = await params;
  const data = await getTicket(decodeURIComponent(key));
  if (!data) notFound();
  const { ticket, step, reports, decisions, people, events, fix, reopened } = data;
  const h = await headers();
  // This page's address on whichever host serves it, for the link back at the end of the Jira description.
  const url = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host")}/tickets/${ticket.key}`;
  const testers = countTesters(reports);
  const name = (id: string | null) => people.find((p) => p.id === id)?.name ?? "Someone";
  // The UAT manager and the developer by role in the history and on the cards (their names are in the header and the
  // Developer box); a tester by name, since many testers report.
  const role = (id: string | null) => {
    const p = people.find((x) => x.id === id);
    return p?.role === "manager" ? "the UAT manager" : p?.role === "developer" ? "the developer" : (p?.name ?? "someone");
  };
  const Role = (id: string | null) => role(id).replace(/^./, (c) => c.toUpperCase());
  const origin = reports.find((r) => r.relation === "origin");
  const originDecision = origin ? decisions.find((d) => d.feedback_id === origin.id) : undefined;
  const isBug = ticket.kind === "bug";
  const known = ticket.origin === "known_issue";
  const developer = people.find((p) => p.role === "developer");
  const testerNames = [...new Set(reports.map((r) => r.tester?.name).filter((n): n is string => !!n))];
  const steps = ticket.steps_to_reproduce.filter(Boolean);
  const showSteps = isBug && (!!step || steps.length > 0);
  // With numbered steps, the test step (which one of them restates) sits quietly beside the steps line; on its own (a
  // known issue has no steps) it goes inside, as the only way to reproduce it.
  const stepInBand = !!step && steps.length > 0;
  // Actual: the ticket's own, or the reports below; a known issue with neither says only what is expected.
  const hasActual = !!ticket.actual || reports.length > 0;
  // Where the ticket came from, once, in the header: the report and who approved it, by role (the name is in the note:
  // a first-time reader should not have to work out who is who). Known issues say "known".
  const from = !known && origin ? { ref: origin.ref, by: originDecision ? name(originDecision.decided_by) : null } : null;
  // The status note is for testers ("Fixed, waiting for the testers to retest."); here the developer's box shows the state.
  const statusNote = ticket.status_note && ![FIXED_NOTE, REOPENED_NOTE].includes(ticket.status_note) ? ticket.status_note : null;
  const testData = testDataOf(data);
  const confirmed = isConfirmed(fix, reports);
  const afterFix = (r: { submitted_at: string }) => !!fix && r.submitted_at > fix.fixedAt;
  const retest = (list: NonNullable<typeof fix>["passed"]): Retest[] =>
    list.map((r) => {
      const report = reports.find((x) => x.id === r.feedbackId);
      return { name: name(r.by), ref: report?.ref ?? "a report", at: r.at, note: r.note };
    });
  // Who has not answered since the fix, with their first report on this ticket.
  const answered = new Set(fix ? [...fix.passed, ...fix.failed].map((a) => a.by) : []);
  const waiting = new Map<string, { name: string; ref: string }>();
  for (const r of fix ? reports : []) {
    if (r.tester_id && !answered.has(r.tester_id) && !waiting.has(r.tester_id)) waiting.set(r.tester_id, { name: name(r.tester_id), ref: r.ref });
  }
  // A tester answers a retest once; the answer stands for each of their reports on this ticket.
  const retestOf = (report: { id: string; tester_id: string | null }) => {
    if (!fix) return null;
    const mine = (r: { feedbackId: string | null; by: string | null }) =>
      report.tester_id ? r.by === report.tester_id : r.feedbackId === report.id;
    const passed = fix.passed.find(mine);
    const failed = fix.failed.find(mine);
    return passed ? { works: true, ...passed } : failed ? { works: false, ...failed } : null;
  };
  // One timeline of the ticket's work: how it was created, and what happened to it afterwards. Each report added to it
  // shows that on its own card, with the time.
  const history = [
    ...decisions
      .filter((d) => d.action !== "link_to_ticket")
      .map((d) => {
        const report = reports.find((r) => r.id === d.feedback_id);
        return { at: d.decided_at, text: `${Role(d.decided_by)} ${ACTION_DONE[d.action as Action]?.did ?? d.action} ${report?.ref ?? "a report"}` };
      }),
    ...events.map((e) => {
      const report = reports.find((r) => r.id === e.feedback_id);
      const who = Role(e.by_id);
      const note = e.note ? `: "${e.note}"` : "";
      const text =
        e.kind === "picked_up"
          ? `${who} picked it up`
          : e.kind === "fixed"
            ? `${who} marked it fixed${note}`
            : e.kind === "reopened"
              ? `${who} reopened it${note}`
              : `${who} retested ${report?.ref ?? ""}: ${e.kind === "retest_passed" ? "works now" : "still broken"}${note}`;
      return { at: e.at, text };
    }),
  ].sort((a, b) => a.at.localeCompare(b.at));

  return (
    <div className="app-container flex flex-col gap-4 py-5">
      {/* Two columns on a wide screen. Below that, one column with the developer's own box straight after the header,
          so the next step is never under the evidence. */}
      <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
        <div className="contents lg:flex lg:min-w-0 lg:flex-col lg:gap-4">
          <header data-tour="ticket" className="rounded-lg border border-box-line bg-white shadow-box p-4 max-lg:-order-2">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              {/* Where this page sits, and the way back to the list, without a row of its own (as in Jira). */}
              <nav aria-label="Breadcrumb" className="flex items-baseline gap-1.5">
                <Link href="/tickets" className="-my-0.5 py-0.5 text-accent hover:underline">
                  Tickets
                </Link>
                <span aria-hidden className="text-slate-400">
                  /
                </span>
                <span aria-current="page" className="font-mono text-slate-600">
                  {ticket.key}
                </span>
              </nav>
              {isBug ? <Severity value={ticket.severity} /> : <Pill>Idea</Pill>}
              {known && <Pill>Known before testing</Pill>}
              <TicketStatusBadge status={ticket.status} kind={ticket.kind} />
              {confirmed && <Pill>Confirmed by every tester</Pill>}
              {from && (
                <span className="text-meta text-slate-500 sm:ml-auto">
                  From report {from.ref}, approved by{" "}
                  {from.by ? (
                    <Tip reach text={from.by}>
                      <span className="cursor-help underline decoration-slate-400 decoration-dotted underline-offset-[3px]">
                        the UAT manager
                      </span>
                    </Tip>
                  ) : (
                    "the UAT manager"
                  )}
                </span>
              )}
            </div>
            <h1 className="mt-1.5 text-title font-semibold text-slate-900">{ticket.title}</h1>
            <p className="mt-2 text-slate-700">{ticket.summary}</p>
            {statusNote && <p className="mt-2 text-sm text-slate-600">{statusNote}</p>}
            {/* Steps to reproduce, folded into the ticket: one line that says what is inside and where the testers
                found it (the step, and the enquiries and test emails they mention), opened with a click. A separate box
                made the page read as one more thing to work out on a first look. */}
            {showSteps && (
              <div className="relative mt-3 border-t border-slate-100 pt-2.5">
                <details className="group">
                  <summary className="flex cursor-pointer list-none flex-wrap items-baseline gap-x-2 gap-y-1 text-sm sm:pr-[calc(50%+1rem)] [&::-webkit-details-marker]:hidden">
                    <span className="inline-flex items-center gap-1.5 font-medium text-accent group-hover:underline">
                      <ChevronDown className="h-4 w-4 self-center transition-transform group-open:rotate-180" />
                      Steps to reproduce
                    </span>
                    <span className="text-meta text-slate-500">
                      {steps.length > 0 ? `${steps.length} step${steps.length === 1 ? "" : "s"} · ` : ""}expected
                      {hasActual ? " and actual" : ""}
                    </span>
                  </summary>
                  <div className="mt-3 grid gap-4 md:grid-cols-2">
                    <div>
                      {step && !stepInBand && (
                        <p className="text-slate-600">
                          Test step <span className="font-mono">{step.id}</span>: {step.instruction}
                        </p>
                      )}
                      {steps.length > 0 && (
                        <ol className="mt-2 list-decimal space-y-0.5 pl-5 text-slate-800 first:mt-0">
                          {steps.map((s, i) => (
                            <li key={i}>{s}</li>
                          ))}
                        </ol>
                      )}
                    </div>
                    <dl className="grid content-start gap-2">
                      <div>
                        <dt className="font-semibold text-slate-900">Expected</dt>
                        <dd className="text-slate-700">{ticket.expected ?? step?.expected ?? "Not stated"}</dd>
                      </div>
                      {hasActual && (
                        <div>
                          <dt className="font-semibold text-slate-900">Actual</dt>
                          <dd className="text-slate-700">{ticket.actual ?? "See the reports below"}</dd>
                        </div>
                      )}
                    </dl>
                  </div>
                </details>
                {/* Beside the line but outside it, so a click on the test data (or selecting it to copy) does not
                    open or close the steps. On a phone it goes under the line. */}
                {(stepInBand || testData.length > 0) && (
                  <Tip
                    reach
                    text={[stepInBand && `Test step ${step.id}: ${step.instruction}`, testData.length > 0 && `Test data: ${testData.join(", ")}`]
                      .filter(Boolean)
                      .join(" · ")}
                  >
                    <span className="mt-1 block truncate text-meta text-slate-600 sm:absolute sm:top-2.5 sm:right-0 sm:mt-0 sm:max-w-[50%]">
                      {stepInBand && (
                        <span className={testData.length > 0 ? "max-sm:hidden" : ""}>
                          Test step <span className="font-mono text-slate-800">{step.id}</span>
                          {/* The instruction for screen readers too, beside the note shown on hover or focus. */}
                          <span className="sr-only">: {step.instruction}</span>
                          {testData.length > 0 && <span className="text-slate-400"> · </span>}
                        </span>
                      )}
                      {testData.length > 0 && (
                        <>
                          Test data: <span className="font-mono text-slate-800">{testData.join(", ")}</span>
                        </>
                      )}
                    </span>
                  </Tip>
                )}
              </div>
            )}
          </header>

          {/* The reports sit in one box, on grey, like a tester's own list of reports. */}
          <section aria-labelledby="evidence" data-tour="evidence" className={BOX}>
            <BoxHeader
              icon={<Speech />}
              titleId="evidence"
              title={
                <>
                  Reports from testers
                  {reports.length > 0 && (
                    <span className="font-normal text-slate-500">
                      {" "}
                      {reports.length} report{reports.length === 1 ? "" : "s"} · {testers} tester{testers === 1 ? "" : "s"}
                    </span>
                  )}
                </>
              }
            />
            <div className="flex flex-col gap-2 bg-slate-50 p-3 sm:px-4">
              {reports.length === 0 && <p className="text-sm text-slate-500">No reports yet.</p>}
              {/* Only where some cards have the AI's suggestion and some do not, to say why. */}
              {decisions.some((d) => d.ai_action) && decisions.some((d) => !d.ai_action) && (
                <p className="text-meta text-slate-500">
                  Older reports were sorted by hand, before AI suggestions were switched on, so they show no AI suggestion.
                </p>
              )}
              <ul className="flex flex-col gap-2 empty:hidden">
                {reports.map((r) => (
                  <li key={r.id}>
                    <EvidenceCard
                      report={r}
                      kind={ticket.kind}
                      ticketStep={showSteps ? ticket.step_id : null}
                      decision={decisions.find((d) => d.feedback_id === r.id)}
                      retest={retestOf(r)}
                      afterFix={afterFix(r)}
                      who={role}
                    />
                  </li>
                ))}
              </ul>
            </div>
          </section>

          {/* Under the reports, so the developer's box and For Jira fit the first screen; last on a phone. */}
          {history.length > 0 && (
            <section aria-labelledby="history" className={`${BOX} max-lg:order-1`}>
              <BoxHeader icon={<Clock />} title="History" titleId="history" />
              <ol className="flex flex-col gap-1.5 px-4 py-3 text-slate-700">
                {history.map((h, i) => (
                  <li key={i} className="lg:grid lg:grid-cols-[6.5rem_minmax(0,1fr)] lg:gap-x-3">
                    <span className="text-meta text-slate-500">{formatWhen(h.at)}</span>
                    <span className="block lg:inline">{h.text}</span>
                  </li>
                ))}
              </ol>
            </section>
          )}
        </div>

        <div className="contents lg:flex lg:flex-col lg:gap-4">
          {isBug && ticket.origin === "cycle" && developer && (
            <DevPanel
              className="max-lg:-order-1"
              ticketKey={ticket.key}
              status={ticket.status}
              owner={ticket.assignee_id ? name(ticket.assignee_id) : null}
              developer={developer.name}
              testers={testerNames}
              confirmed={confirmed}
              waiting={[...waiting.values()]}
              newSinceFix={reports.filter(afterFix).length}
              fix={
                fix
                  ? { at: fix.fixedAt, by: fix.fixedBy ? name(fix.fixedBy) : null, note: fix.note, passed: retest(fix.passed), failed: retest(fix.failed) }
                  : null
              }
              reopened={reopened ? { at: reopened.at, note: reopened.note, failed: retest(reopened.failed) } : null}
            />
          )}

          <JiraFields fields={jiraFields(data, url)} className={BOX} />
        </div>
      </div>
    </div>
  );
}

/** One report on this ticket: the tester, who decided it and whether the AI agreed, and a failed retest if any. */
function EvidenceCard({
  report: r,
  kind,
  ticketStep,
  decision: d,
  retest,
  afterFix,
  who,
}: {
  report: Data["reports"][number];
  kind: "bug" | "idea";
  /** The step the ticket's header already names (beside Steps to reproduce): a card only shows a different one. */
  ticketStep: string | null;
  decision: Data["decisions"][number] | undefined;
  retest: { works: boolean; at: string; note: string | null } | null;
  /** Sent after the ticket was marked fixed: the fix may not have reached this tester, or it may not work. */
  afterFix: boolean;
  who: (id: string | null) => string;
}) {
  return (
    <article className={`rounded-lg border bg-white px-4 py-3 text-sm ${afterFix ? "border-amber-300" : "border-box-line"}`}>
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-meta text-slate-500">
        {r.relation && <Pill>{relationLabel(r.relation, kind)}</Pill>}
        {afterFix && <Pill tone="attention">Reported after the fix</Pill>}
        <span className="font-medium text-slate-800">{r.tester?.name ?? "Unknown tester"}</span>
        {/* The dot ends the team, so a wrapped line starts with the report and not with a dot. */}
        {r.tester ? (
          <span>
            {r.tester.team}
            <span aria-hidden className="ml-2">
              ·
            </span>
          </span>
        ) : (
          <span aria-hidden>·</span>
        )}
        <span className="font-mono">{r.ref}</span>
        {r.step_id && r.step_id !== ticketStep && (
          <Tip reach text={r.step?.instruction ?? r.step_id}>
            <span className="font-mono">{r.step_id}</span>
          </Tip>
        )}
        {/* Only the result a reader would not expect: a bug report says "Failed" by being on a bug. */}
        {r.reported_result === "fail" && kind === "idea" && (
          <span className="inline-flex items-center gap-0.5 text-red-700">
            <Cross className="h-3.5 w-3.5" /> Failed
          </span>
        )}
        {r.reported_result === "pass" && kind === "bug" && (
          <span className="inline-flex items-center gap-0.5 text-slate-700">
            <Check className="h-3.5 w-3.5" /> Passed
          </span>
        )}
        <span>{formatDay(r.submitted_at)}</span>
        {/* Who put it on this ticket, at the row's end on a wide screen (its own line on a narrow one). */}
        {d && (
          <span className="text-slate-600 sm:ml-auto">
            {ACTION_DONE[d.action as Action]?.by ?? d.action} {who(d.decided_by)}, {formatWhen(d.decided_at)}
            {d.ai_action ? (
              d.overridden ? (
                <span className="text-amber-900"> · the AI suggested {aiLabel(d.ai_action)}; changed by a person</span>
              ) : (
                <span>
                  {" "}
                  · the AI suggested the same
                  {d.ai_confidence !== null ? ` (${Math.round(d.ai_confidence * 100)}% sure)` : ""}
                </span>
              )
            ) : null}
          </span>
        )}
      </p>
      <p className="mt-1.5 text-slate-900">&ldquo;{r.text}&rdquo;</p>
      {r.follow_up_question && r.follow_up_answer && (
        <p className="mt-1.5 text-slate-700">
          <span className="text-slate-500">Asked:</span> {r.follow_up_question}
          <span className="block">
            <span className="text-slate-500">Answer:</span> {r.follow_up_answer}
          </span>
        </p>
      )}
      {/* Who said "works now" is listed in the developer's box; a card only flags "still broken". */}
      {retest && !retest.works && (
        <p className="mt-1.5 flex items-center gap-1.5 text-meta text-red-800">
          <Cross className="h-3.5 w-3.5" />
          <span>
            Retested {formatWhen(retest.at)}: still broken
            {retest.note && <span className="text-slate-700">: {retest.note}</span>}
          </span>
        </p>
      )}
    </article>
  );
}

const PRIORITY: Record<NonNullable<Data["ticket"]["severity"]>, string> = {
  critical: "Highest",
  high: "High",
  medium: "Medium",
  low: "Low",
};

/**
 * Enquiry and test-email numbers the testers mention, so the developer can open the same data. The patterns are the
 * sample cycle's (MI-12345, EML-11): another app's test data would need its own.
 */
const TEST_DATA = /\b(?:MI-\d{5}|EML-\d{2})\b/g;

/** Each enquiry or test-email number once, in the order met: summary, steps, then each report and its answer. */
function testDataOf({ ticket, reports }: Pick<Data, "ticket" | "reports">): string[] {
  const words = [ticket.summary, ...ticket.steps_to_reproduce, ...reports.flatMap((r) => [r.text, r.follow_up_answer ?? ""])];
  return [...new Set(words.join(" ").match(TEST_DATA) ?? [])];
}

/** A date as the Jira description writes it, "3 Nov 2026", on the London calendar. */
const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" });

/**
 * The fields of a Jira issue, filled from the ticket and its evidence, as plain text that pastes cleanly into Jira
 * Cloud or Data Center. Nothing is sent to Jira: a person copies what they need.
 */
function jiraFields({ ticket, step, reports, cycle, script, fix, people }: Data, url: string): JiraField[] {
  const isBug = ticket.kind === "bug";
  const nameOf = (id: string | null) => people.find((p) => p.id === id)?.name ?? "the developer";
  const steps = ticket.steps_to_reproduce.filter(Boolean);
  const testData = testDataOf({ ticket, reports });
  const testers = countTesters(reports);
  // Only testers we know can be asked to retest; an imported row with no name cannot confirm a fix.
  const retesters = new Set(reports.map((r) => r.tester_id).filter(Boolean)).size;
  // Jira labels are single words: the cycle, and the test step (or script) it came from.
  const labels = [cycle?.name.toLowerCase().replace(/\s+/g, "-"), step?.id ?? script?.id, isBug ? null : "idea"].filter(
    (l): l is string => !!l,
  );
  const first = day(reports[0]?.submitted_at ?? "");
  const last = day(reports.at(-1)?.submitted_at ?? "");
  const description = [
    ticket.summary,
    isBug && steps.length ? ["", "Steps to reproduce", ...steps.map((x, i) => `${i + 1}. ${x}`)] : [],
    isBug ? ["", `Expected: ${ticket.expected ?? step?.expected ?? "Not stated"}`] : [],
    isBug && (ticket.actual || reports.length) ? [`Actual: ${ticket.actual ?? "See the reports below"}`] : [],
    step ? ["", `Test step: ${step.id} ${step.instruction}`] : [],
    testData.length ? [`Test data: ${testData.join(", ")}`] : [],
    ticket.status_note && ticket.origin === "known_issue" ? [`Note: ${ticket.status_note}`] : [],
    reports.length
      ? [
          "",
          `Reported by ${testers} tester${testers === 1 ? "" : "s"} in ${reports.length} report${reports.length === 1 ? "" : "s"}, ${first}${
            last !== first ? ` to ${last}` : ""
          }:`,
          ...reports.flatMap((r) => [
            `- ${r.ref}, ${r.tester?.name ?? "unknown tester"}${r.relation ? ` (${relationLabel(r.relation, ticket.kind).toLowerCase()})` : ""}: "${r.text}"`,
            ...(r.follow_up_question && r.follow_up_answer ? [`  Asked: ${r.follow_up_question} Answer: ${r.follow_up_answer}`] : []),
          ]),
        ]
      : [],
    // The fix and what the testers found when they retested it, so Jira shows where the loop stands.
    fix
      ? [
          "",
          `Fixed by ${nameOf(fix.fixedBy)} on ${day(fix.fixedAt)}.${fix.note ? ` Developer's note: ${fix.note.trim()}` : ""}`,
          isConfirmed(fix, reports)
            ? `Retest in UAT: confirmed by ${retesters === 1 ? "the tester" : `all ${retesters} testers`} who reported it.`
            : `Retest in UAT: ${retestTally(fix.passed.length, fix.failed.length, notYetRetested(fix, reports))}.`,
        ]
      : [],
    "",
    `Sorted in Untangle: a person decided every report. ${url}`,
  ]
    .flat()
    .join("\n");
  return [
    { label: "Summary", value: ticket.title },
    { label: "Issue type", value: isBug ? "Bug" : "Story" },
    ...(isBug && ticket.severity ? [{ label: "Priority", value: PRIORITY[ticket.severity] }] : []),
    // The cycle's name already says UAT ("UAT Cycle 3").
    { label: "Environment", value: [cycle?.app_name, cycle?.name].filter(Boolean).join(" · ") || "UAT" },
    ...(script ? [{ label: "Component", value: `${script.area} (${script.id} ${script.title})` }] : []),
    ...(labels.length ? [{ label: "Labels", value: labels.join(" ") }] : []),
    { label: "Description", value: description, long: true },
  ];
}

/** A white box with a title bar (`BoxHeader`), which clips the bar's corners. */
const BOX = "overflow-hidden rounded-lg border border-box-line bg-white shadow-box text-sm";
