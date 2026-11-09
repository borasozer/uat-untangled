import { db, DbError, must } from "./db";
import type { Analysis, ConfidenceDetail } from "./ai/schema";
import { bucketOf, type Bucket } from "./labels";
import { fixState, isConfirmed, notYetRetested, reopenReason, reopenState, type FixState } from "./ticket-work";
import type { Cycle, Decision, Feedback, Person, Script, Step, Ticket, TicketEvent } from "./types";

/**
 * What the pages read, on the server. Nothing here writes. Small tables (people, steps, tickets) are read whole and
 * matched in code. The functions in the order they appear, and where each is used:
 *   getPeople: the header, Review, Tickets, the Tester page and Import.
 *   getStepIds: Import, to read a sheet's test step column.
 *   getCycle: the footer line, and the Tester page's box on what is being tested.
 *   getRules: Review, for the rules a suggestion cites.
 *   getScriptsWithSteps: the Tester page's list of test scripts and steps.
 *   getEvents: each ticket's history (picked up, fixed, retested, reopened), for the functions below.
 *   countTesters: how many people reported something, for the functions below and one ticket's page.
 *   getTickets: Tickets, the developer's list, and Review, the tickets each report is judged against.
 *   getTicketQuotes: Review, the first report on each ticket in the tester's words.
 *   getTicket: one ticket's page: its reports, the decisions behind them, its history and the For Jira fields.
 *   getQueue: Review, the reports still to decide and those waiting for a tester's answer.
 *   getTesterFeedback: the Tester page's "Your reports".
 *   getOverview: Overview and Insights.
 *   getBatchSummary: Import, what the latest import became; also returned when an import finishes (app/actions.ts).
 */

export type AnalysisRow = {
  id: string;
  feedback_id: string;
  model: string;
  suggestion: Analysis;
  samples: Analysis[];
  confidence: number;
  confidence_detail: ConfidenceDetail;
  latency_ms: number | null;
  created_at: string;
};

/** A report in Review's queue, with its tester, its step and the AI's latest suggestion (null while none is saved). */
export type QueueItem = Feedback & {
  tester: Person | null;
  step: Step | null;
  analysis: AnalysisRow | null;
  /** If the AI pointed at a pending report that has since become a ticket. */
  resolvedTarget: { ref: string; ticketKey: string } | null;
  /** Other undecided reports the AI matched to this one (same new problem). */
  followers: string[];
};

export async function getPeople(): Promise<Person[]> {
  return must(await db().from("people").select("*").order("id"), "load people") as Person[];
}

/** The cycle's step IDs ("TS-04.1"), for reading a spreadsheet's test step column. */
export async function getStepIds(): Promise<string[]> {
  return (must(await db().from("steps").select("id").order("id"), "load steps") as { id: string }[]).map((s) => s.id);
}

/** The test cycle and the app it tests. Nothing about the app is written in the code: it all comes from here. */
export async function getCycle(): Promise<Cycle | null> {
  const res = await db().from("cycles").select("*").limit(1).maybeSingle();
  if (res.error) throw new DbError(`load cycle: ${res.error.message}`);
  return res.data as Cycle | null;
}

/** The cycle's rules: what works as designed. Suggestions cite them by id. */
export async function getRules(): Promise<{ id: string; rule: string }[]> {
  return must(await db().from("app_rules").select("id, rule").order("id"), "load rules") as { id: string; rule: string }[];
}

export async function getScriptsWithSteps(): Promise<(Script & { steps: Step[] })[]> {
  const supabase = db();
  const [scripts, steps] = await Promise.all([
    supabase.from("scripts").select("*").order("sort"),
    supabase.from("steps").select("*").order("step_no"),
  ]);
  const allSteps = must(steps, "load steps") as Step[];
  return (must(scripts, "load scripts") as Script[]).map((s) => ({
    ...s,
    steps: allSteps.filter((st) => st.script_id === s.id),
  }));
}

async function getEvents(ticketIds?: string[]): Promise<TicketEvent[]> {
  let query = db().from("ticket_events").select("*").order("at");
  if (ticketIds) query = query.in("ticket_id", ticketIds);
  return must(await query, "load ticket events") as TicketEvent[];
}

/** Distinct people behind some reports. An imported row with no known tester counts as its own person. */
export function countTesters(reports: { tester_id: string | null }[]): number {
  return new Set(reports.map((r, i) => r.tester_id ?? `unknown-${i}`)).size;
}

/** Every ticket, newest first, with its report and tester counts and, once it is fixed, where the retest stands. */
export async function getTickets(): Promise<
  (Ticket & { reports: number; testers: number; fix: FixState | null; confirmed: boolean; notYet: number })[]
> {
  const supabase = db();
  const [tickets, links, events] = await Promise.all([
    supabase.from("tickets").select("*").order("created_at", { ascending: false }),
    supabase.from("feedback").select("ticket_id, tester_id, submitted_at").not("ticket_id", "is", null),
    getEvents(),
  ]);
  const rows = must(links, "load links") as { ticket_id: string; tester_id: string | null; submitted_at: string }[];
  return (must(tickets, "load tickets") as Ticket[]).map((t) => {
    const mine = rows.filter((r) => r.ticket_id === t.id);
    const fix = t.status === "fixed" ? fixState(events.filter((e) => e.ticket_id === t.id)) : null;
    return {
      ...t,
      reports: mine.length,
      testers: countTesters(mine),
      fix,
      confirmed: isConfirmed(fix, mine),
      notYet: notYetRetested(fix, mine),
    };
  });
}

/** The first few reports on each ticket, in the testers' words, oldest first: what a report would be joining. */
export async function getTicketQuotes(perTicket = 3): Promise<Record<string, string[]>> {
  const rows = must(
    await db().from("feedback").select("ticket_id, text").not("ticket_id", "is", null).order("submitted_at").order("ref"),
    "load reports on tickets",
  ) as { ticket_id: string; text: string }[];
  const out: Record<string, string[]> = {};
  for (const r of rows) {
    const list = (out[r.ticket_id] ??= []);
    if (list.length < perTicket) list.push(r.text);
  }
  return out;
}

/** Everything one ticket's page shows, found by its key ("MIA-101"); null when no ticket has that key. */
export async function getTicket(key: string) {
  const supabase = db();
  const ticket = (await supabase.from("tickets").select("*").eq("key", key).maybeSingle()).data as Ticket | null;
  if (!ticket) return null;
  const [feedback, people, steps, decisions, events, cycle, scripts] = await Promise.all([
    supabase.from("feedback").select("*").eq("ticket_id", ticket.id).order("submitted_at").order("ref"),
    supabase.from("people").select("*"),
    supabase.from("steps").select("*"),
    supabase.from("decisions").select("*").eq("ticket_id", ticket.id).order("decided_at"),
    getEvents([ticket.id]),
    supabase.from("cycles").select("name, app_name").eq("id", ticket.cycle_id).maybeSingle(),
    supabase.from("scripts").select("id, title, area"),
  ]);
  const ps = must(people, "load people") as Person[];
  const ss = must(steps, "load steps") as Step[];
  const step = ss.find((s) => s.id === ticket.step_id) ?? null;
  const ds = must(decisions, "load decisions") as Decision[];
  // How sure the AI was when each decision was made, for the evidence cards.
  const analysisIds = ds.map((d) => d.analysis_id).filter((id): id is string => !!id);
  const confidence = analysisIds.length
    ? (must(
        await supabase.from("analyses").select("id, confidence").in("id", analysisIds),
        "load analyses",
      ) as { id: string; confidence: number }[])
    : [];
  return {
    ticket,
    step,
    /** The test round and the script of the ticket's step: Jira's Environment and Component. */
    cycle: cycle.data as Pick<Cycle, "name" | "app_name"> | null,
    script: step ? ((scripts.data ?? []) as Pick<Script, "id" | "title" | "area">[]).find((x) => x.id === step.script_id) ?? null : null,
    reports: (must(feedback, "load reports") as Feedback[]).map((f) => ({
      ...f,
      tester: ps.find((p) => p.id === f.tester_id) ?? null,
      step: ss.find((s) => s.id === f.step_id) ?? null,
    })),
    decisions: ds.map((d) => ({
      ...d,
      ai_confidence: confidence.find((a) => a.id === d.analysis_id)?.confidence ?? null,
    })),
    people: ps,
    events,
    fix: ticket.status === "fixed" ? fixState(events) : null,
    /** Why it was reopened and who still found it broken, while the developer works on it again. */
    reopened: ticket.status === "in_progress" ? reopenState(events) : null,
  };
}

/** Items a person still has to decide, plus those waiting for a tester's answer. */
export async function getQueue(): Promise<QueueItem[]> {
  const supabase = db();
  const [feedback, people, steps, tickets] = await Promise.all([
    supabase
      .from("feedback")
      .select("*")
      .in("status", ["new", "awaiting_review", "needs_info"])
      .order("submitted_at")
      .order("ref"),
    supabase.from("people").select("*"),
    supabase.from("steps").select("*"),
    supabase.from("tickets").select("id, key"),
  ]);
  const items = must(feedback, "load queue") as Feedback[];
  const analyses = items.length
    ? (must(
        await supabase
          .from("analyses")
          .select("*")
          .in(
            "feedback_id",
            items.map((f) => f.id),
          )
          .order("created_at", { ascending: false }),
        "load analyses",
      ) as AnalysisRow[])
    : [];
  const ps = must(people, "load people") as Person[];
  const ss = must(steps, "load steps") as Step[];
  const ts = must(tickets, "load tickets") as { id: string; key: string }[];

  // Pending targets that have become tickets since the analysis ran.
  const targetRefs = analyses
    .map((a) => a.suggestion.match.target)
    .filter((t): t is string => !!t && /^(FB|IMP|TR)-/i.test(t));
  const decidedTargets = targetRefs.length
    ? ((await supabase.from("feedback").select("ref, ticket_id").in("ref", targetRefs)).data ?? [])
    : [];

  const latest = new Map<string, AnalysisRow>();
  for (const a of analyses) if (!latest.has(a.feedback_id)) latest.set(a.feedback_id, a);

  return items.map((f) => {
    const analysis = latest.get(f.id) ?? null;
    const target = analysis?.suggestion.match.target;
    const decided = decidedTargets.find((d) => d.ref === target && d.ticket_id);
    const ticketKey = decided ? ts.find((t) => t.id === decided.ticket_id)?.key : undefined;
    return {
      ...f,
      tester: ps.find((p) => p.id === f.tester_id) ?? null,
      step: ss.find((s) => s.id === f.step_id) ?? null,
      analysis,
      resolvedTarget: target && ticketKey ? { ref: target, ticketKey } : null,
      // Other reports the AI suggests linking to this one (not merely related to it).
      followers: items
        .filter((o) => {
          const s = latest.get(o.id)?.suggestion;
          return o.id !== f.id && s?.suggested_action === "link_to_ticket" && s.match.target === f.ref;
        })
        .map((o) => o.ref),
    };
  });
}

/** One tester's reports, newest first, each with its ticket, the retest asked of them and who else reported it. */
export async function getTesterFeedback(testerId: string) {
  const supabase = db();
  const [feedback, steps, tickets, events, links, asks] = await Promise.all([
    supabase.from("feedback").select("*").eq("tester_id", testerId).order("submitted_at", { ascending: false }),
    supabase.from("steps").select("*"),
    supabase.from("tickets").select("id, key, title, kind, origin, status, status_note, assignee_id"),
    getEvents(),
    supabase.from("feedback").select("ticket_id, tester_id, submitted_at").not("ticket_id", "is", null),
    supabase.from("decisions").select("feedback_id").eq("action", "ask_tester"),
  ]);
  const askedByManager = new Set((must(asks, "load questions from the manager") as { feedback_id: string }[]).map((d) => d.feedback_id));
  const onTickets = must(links, "load reports on tickets") as {
    ticket_id: string;
    tester_id: string | null;
    submitted_at: string;
  }[];
  const ss = must(steps, "load steps") as Step[];
  const ts = must(tickets, "load tickets") as Pick<
    Ticket,
    "id" | "key" | "title" | "kind" | "origin" | "status" | "status_note" | "assignee_id"
  >[];
  const mine = must(feedback, "load feedback") as Feedback[];
  return mine.map((f) => {
    const ticket = ts.find((t) => t.id === f.ticket_id) ?? null;
    const ticketEvents = ticket ? events.filter((e) => e.ticket_id === ticket.id) : [];
    const reports = ticket ? onTickets.filter((r) => r.ticket_id === ticket.id) : [];
    // A fixed ticket asks every tester who reported it to retest, once: the request sits on their first report
    // on that ticket, and their answer covers all of their reports on it.
    const fix = ticket?.status === "fixed" ? fixState(ticketEvents) : null;
    const answers = fix ? [...fix.passed.map((r) => ({ ...r, works: true })), ...fix.failed.map((r) => ({ ...r, works: false }))] : [];
    const retest = answers.find((r) => r.by === testerId) ?? null;
    const first = ticket
      ? mine.filter((o) => o.ticket_id === ticket.id).reduce((a, b) => (a.submitted_at <= b.submitted_at ? a : b))
      : null;
    return {
      ...f,
      step: ss.find((s) => s.id === f.step_id) ?? null,
      ticket,
      fix,
      retest,
      /** The report that carries this tester's retest request for the ticket. */
      retestRef: first?.ref ?? f.ref,
      /** Other people who reported the same ticket, so the tester knows they are not alone. */
      othersOnTicket: ticket ? countTesters(reports.filter((r) => r.tester_id !== testerId)) : 0,
      /** Every tester who reported the ticket says the fix works (the same rule as the ticket list). */
      confirmed: isConfirmed(fix, reports),
      /** Testers who reported the ticket and have not retested the fix yet. */
      notYet: notYetRetested(fix, reports),
      reopened: ticket?.status === "in_progress" ? reopenReason(ticketEvents) : null,
      /** The UAT manager asked this tester a question about it (not the automatic check before sending). */
      managerAsked: askedByManager.has(f.id),
    };
  });
}

/** The rows Overview and Insights count from, with only the columns they use; the pages do the counting. */
export async function getOverview() {
  const supabase = db();
  const [feedback, tickets, decisions, scripts, cycle, events] = await Promise.all([
    supabase.from("feedback").select("id, ref, status, source, submitted_at, ticket_id, relation, step_id, tester_id"),
    supabase.from("tickets").select("id, key, kind, origin, severity, status, step_id, title"),
    supabase.from("decisions").select("id, feedback_id, action, ai_action, overridden, analysis_id, decided_at"),
    supabase.from("scripts").select("id, title, sort").order("sort"),
    supabase.from("cycles").select("*").limit(1).maybeSingle(),
    getEvents(),
  ]);
  const decisionRows = must(decisions, "load decisions") as Pick<
    Decision,
    "id" | "feedback_id" | "action" | "ai_action" | "overridden" | "analysis_id" | "decided_at"
  >[];
  const analysisIds = decisionRows.map((d) => d.analysis_id).filter((id): id is string => !!id);
  const analyses = analysisIds.length
    ? (must(
        await supabase.from("analyses").select("id, confidence").in("id", analysisIds),
        "load analyses",
      ) as { id: string; confidence: number }[])
    : [];
  return {
    cycle: cycle.data as { name: string; app_name: string; starts_on: string; ends_on: string } | null,
    feedback: must(feedback, "load feedback") as Pick<
      Feedback,
      "id" | "ref" | "status" | "source" | "submitted_at" | "ticket_id" | "relation" | "step_id" | "tester_id"
    >[],
    tickets: must(tickets, "load tickets") as Pick<
      Ticket,
      "id" | "key" | "kind" | "origin" | "severity" | "status" | "step_id" | "title"
    >[],
    decisions: decisionRows,
    confidenceByAnalysis: new Map(analyses.map((a) => [a.id, Number(a.confidence)])),
    scripts: must(scripts, "load scripts") as Pick<Script, "id" | "title" | "sort">[],
    events,
  };
}

/** What an imported spreadsheet became, in the same words as the review queue. Built from saved suggestions. */
export type BatchSummary = {
  id: string;
  label: string;
  /** When the sheet was imported. */
  createdAt: string;
  rows: number;
  /** Every row's reference, in order. */
  refs: string[];
  /** Rows not analysed yet (an analysis failed, or the import was left before it finished). */
  pending: string[];
  /** Someone is importing it right now (a row was analysed, or it started, in the last two minutes): leave it be. */
  beingImported: boolean;
  analysed: number;
  /** New problems: each first report with the other rows of the batch that describe the same thing. */
  problems: { lead: string; refs: string[]; text: string }[];
  /**
   * Rows the AI matched to another report that is not a new problem of this batch and has not become a ticket:
   * `inReview` when that report still waits in Review.
   */
  sameAsReport: { target: string; refs: string[]; inReview: boolean }[];
  /** Rows a person has decided since (a question to the tester still waits in Review): they have left the queue. */
  decided: string[];
  /** Every other row by bucket, most useful first. */
  buckets: { bucket: Bucket; refs: string[]; tickets: string[] }[];
};

const BUCKET_ORDER: Bucket[] = ["same_bug", "other_symptom", "already_known", "thin_evidence", "idea", "by_design", "question", "nothing_to_fix"];

/**
 * No batchId: the newest of the last five imports that has rows, or null. A batchId: that one, and beingImported is
 * always false.
 */
export async function getBatchSummary(batchId?: string): Promise<BatchSummary | null> {
  const supabase = db();
  // The latest import with rows, finished or not: one left half way shows what it has, and the rows still to analyse.
  type BatchRow = { id: string; label: string; created_at: string; status: string };
  const candidates = (
    batchId
      ? [(await supabase.from("batches").select("id, label, created_at, status").eq("id", batchId).maybeSingle()).data]
      : (await supabase.from("batches").select("id, label, created_at, status").order("created_at", { ascending: false }).limit(5)).data ?? []
  ).filter(Boolean) as BatchRow[];
  let batch: BatchRow | null = null;
  let rows: Pick<Feedback, "id" | "ref" | "text" | "status">[] = [];
  for (const b of candidates) {
    rows = must(
      await supabase.from("feedback").select("id, ref, text, status").eq("batch_id", b.id).order("ref"),
      "load imported rows",
    ) as Pick<Feedback, "id" | "ref" | "text" | "status">[];
    if (rows.length) {
      batch = b;
      break;
    }
  }
  if (!batch) return null;
  const [analyses, tickets] = await Promise.all([
    supabase
      .from("analyses")
      .select("feedback_id, suggestion, created_at")
      .in(
        "feedback_id",
        rows.map((r) => r.id),
      )
      .order("created_at", { ascending: false }),
    supabase.from("tickets").select("id, key, origin, kind"),
  ]);
  const latest = new Map<string, Analysis>();
  const analysisRows = must(analyses, "load analyses") as { feedback_id: string; suggestion: Analysis; created_at: string }[];
  for (const a of analysisRows) {
    if (!latest.has(a.feedback_id)) latest.set(a.feedback_id, a.suggestion);
  }
  const lastActivity = Math.max(Date.parse(batch.created_at), ...analysisRows.map((a) => Date.parse(a.created_at)));
  const beingImported = !batchId && batch.status === "analysing" && Date.now() - lastActivity < 2 * 60_000;
  const ticketList = must(tickets, "load tickets") as Pick<Ticket, "id" | "key" | "origin" | "kind">[];
  const byKey = new Map(ticketList.map((t) => [t.key, t]));
  const keyById = new Map(ticketList.map((t) => [t.id, t.key]));
  // Reports the AI matched rows to, when they are not tickets: where each stands now.
  const reportTargets = [
    ...new Set(
      [...latest.values()]
        .filter((s) => s.suggested_action === "link_to_ticket" && s.match.target && !byKey.has(s.match.target))
        .map((s) => s.match.target!),
    ),
  ];
  const reports = new Map(
    reportTargets.length
      ? (
          must(
            await supabase.from("feedback").select("ref, status, ticket_id").in("ref", reportTargets),
            "load matched reports",
          ) as Pick<Feedback, "ref" | "status" | "ticket_id">[]
        ).map((f) => [f.ref, f])
      : [],
  );

  const problems = new Map<string, { lead: string; refs: string[]; text: string }>();
  const sameAsReport = new Map<string, { refs: string[]; inReview: boolean }>();
  const buckets = new Map<Bucket, { refs: string[]; tickets: Set<string> }>();
  // First reports of a new problem lead; rows the AI matched to another row of this batch join that problem.
  for (const r of rows) {
    const s = latest.get(r.id);
    if (s?.suggested_action === "create_ticket") problems.set(r.ref, { lead: r.ref, refs: [r.ref], text: r.text });
  }
  for (const r of rows) {
    const s = latest.get(r.id);
    if (!s || s.suggested_action === "create_ticket") continue;
    const link = s.suggested_action === "link_to_ticket";
    let target = s.match.target ?? null;
    if (link && target && !byKey.has(target)) {
      // Matched to another report: a new problem of this batch, the ticket that report has become since, or the report.
      const p = problems.get(target);
      if (p) {
        p.refs.push(r.ref);
        continue;
      }
      const report = reports.get(target);
      const becameTicket = report?.ticket_id ? keyById.get(report.ticket_id) : undefined;
      if (becameTicket) target = becameTicket;
      else if (s.category !== "idea") {
        const inReview = !!report && ["new", "awaiting_review", "needs_info"].includes(report.status);
        const same = sameAsReport.get(target) ?? { refs: [], inReview };
        same.refs.push(r.ref);
        sameAsReport.set(target, same);
        continue;
      }
    }
    const ticket = link && target ? byKey.get(target) : undefined;
    const bucket = bucketOf({
      action: s.suggested_action,
      relation: s.match.relation,
      targetOrigin: ticket?.origin ?? null,
      targetKind: ticket?.kind ?? null,
      category: s.category,
    });
    const b = buckets.get(bucket) ?? { refs: [], tickets: new Set<string>() };
    b.refs.push(r.ref);
    if (ticket) b.tickets.add(ticket.key);
    buckets.set(bucket, b);
  }
  return {
    id: batch.id,
    label: batch.label,
    createdAt: batch.created_at,
    rows: rows.length,
    refs: rows.map((r) => r.ref),
    pending: rows.filter((r) => r.status === "new").map((r) => r.id),
    beingImported,
    analysed: rows.filter((r) => latest.has(r.id)).length,
    problems: [...problems.values()],
    sameAsReport: [...sameAsReport].map(([target, v]) => ({ target, ...v })),
    decided: rows.filter((r) => !["new", "awaiting_review", "needs_info"].includes(r.status)).map((r) => r.ref),
    buckets: BUCKET_ORDER.filter((b) => buckets.has(b)).map((b) => ({
      bucket: b,
      refs: buckets.get(b)!.refs,
      tickets: [...buckets.get(b)!.tickets].sort(),
    })),
  };
}
