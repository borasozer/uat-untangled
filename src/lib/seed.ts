import sample from "../../data/sample/medinfo-cycle3.json";
import seedAnalyses from "../../data/sample/seed-analyses.json";
import { db, DbError, must } from "./db";
import type { Relation, Truth } from "./types";

/**
 * The shared demo's starting state, from the fictional sample cycle (data/sample/medinfo-cycle3.json): the cycle and its
 * rules, people, test scripts and steps, the tickets, and every sample report with the decisions made before the demo
 * starts. "Start the demo over", the start over after an hour idle (demo.ts), `npm run seed` and `npm run smoke` all run
 * resetDemo. It empties every table except ai_usage, so the spend ledger and its budgets carry on across resets, and it
 * makes no AI call: pending reports get their saved suggestions back.
 */

type SampleDecided = {
  status: string;
  ticket?: string;
  relation?: Relation;
  message?: string;
  question?: string;
};

/** A report as the sample file writes it. One without decided starts in Review; truth: labels to measure the AI. */
type SampleFeedback = {
  ref: string;
  tester: string;
  /** null: general feedback, not on a test step. */
  step: string | null;
  result: "pass" | "fail" | null;
  at: string;
  text: string;
  decided?: SampleDecided;
  truth: Truth;
};

/** Grace Liu, the UAT manager: the decisions made before the demo starts are recorded as hers. */
const MANAGER_ID = "M1";

/** Tables in delete order (children first). */
const TABLES = [
  "ticket_events",
  "decisions",
  "analyses",
  "feedback",
  "batches",
  "tickets",
  "steps",
  "scripts",
  "app_rules",
  "people",
  "cycles",
] as const;

/** The AI's suggestions for the reports still waiting in Review, saved once by ref, so a reset makes no AI call. */
const savedAnalyses = (seedAnalyses as { analyses: Record<string, Record<string, unknown>> }).analyses;

/** Tickets a developer has already picked up when the demo starts. */
const pickedUp = sample.tickets.filter(
  (t): t is (typeof sample.tickets)[number] & { assignee: string; picked_up_at: string } => "assignee" in t,
);

/** Row counts right after a reset: anything else means someone has used the demo since. */
export const SEED_BASELINE = {
  ticketEvents: pickedUp.length,
  feedback: sample.feedback.length,
  decisions: (sample.feedback as SampleFeedback[]).filter((f) => f.decided).length,
  analyses: (sample.feedback as SampleFeedback[]).filter((f) => !f.decided && savedAnalyses[f.ref]).length,
};

/**
 * Restores the demo to its starting state: the sample cycle, its tickets and the
 * feedback history. Pending reports get their saved AI analyses back (data/sample/seed-analyses.json).
 */
export async function resetDemo({ restoreAnalyses = true } = {}): Promise<{ feedback: number; tickets: number }> {
  const supabase = db();

  for (const table of TABLES) {
    const res = await supabase.from(table).delete().not("id", "is", null);
    if (res.error) throw new DbError(`clear ${table}: ${res.error.message}`);
  }

  const cycle = sample.cycle;
  must(await supabase.from("cycles").insert(cycle).select("id"), "insert cycle");
  must(
    await supabase
      .from("app_rules")
      .insert(sample.app_rules.map((r) => ({ ...r, cycle_id: cycle.id })))
      .select("id"),
    "insert rules",
  );
  must(await supabase.from("people").insert(sample.people).select("id"), "insert people");
  must(
    await supabase
      .from("scripts")
      .insert(
        sample.scripts.map((s) => ({
          id: s.id,
          cycle_id: cycle.id,
          title: s.title,
          area: s.area,
          sort: s.sort,
        })),
      )
      .select("id"),
    "insert scripts",
  );
  must(
    await supabase
      .from("steps")
      .insert(
        sample.scripts.flatMap((s) =>
          s.steps.map((st) => ({ id: `${s.id}.${st.step_no}`, script_id: s.id, ...st })),
        ),
      )
      .select("id"),
    "insert steps",
  );

  const feedbackList = sample.feedback as SampleFeedback[];
  const timeByRef = new Map(feedbackList.map((f) => [f.ref, f.at]));

  const tickets = must(
    await supabase
      .from("tickets")
      .insert(
        sample.tickets.map((t) => ({
          key: t.key,
          cycle_id: cycle.id,
          kind: t.kind,
          origin: t.origin,
          title: t.title,
          summary: t.summary,
          step_id: t.step_id,
          steps_to_reproduce: "steps_to_reproduce" in t ? t.steps_to_reproduce : [],
          expected: "expected" in t ? t.expected : null,
          actual: "actual" in t ? t.actual : null,
          severity: "severity" in t ? t.severity : null,
          status: t.status,
          status_note: "status_note" in t ? t.status_note : null,
          created_by: "created_by" in t ? t.created_by : null,
          assignee_id: "assignee" in t ? t.assignee : null,
          // A ticket opened by a sample report is dated when that report came in; a known issue, before the cycle began.
          created_at:
            ("source_ref" in t && timeByRef.get(t.source_ref as string)) || "2026-10-20T09:00:00Z",
        })),
      )
      .select("id, key"),
    "insert tickets",
  ) as { id: string; key: string }[];
  const ticketId = new Map(tickets.map((t) => [t.key, t.id]));
  if (pickedUp.length) {
    must(
      await supabase
        .from("ticket_events")
        .insert(pickedUp.map((t) => ({ ticket_id: ticketId.get(t.key), kind: "picked_up", by_id: t.assignee, at: t.picked_up_at })))
        .select("id"),
      "insert ticket events",
    );
  }

  // A pending report with a saved suggestion is written as awaiting review straight away and its suggestion last: a
  // reset cut off before that last write leaves no suggestions at all, which the demo check recognises (demo.ts).
  const restoring = (f: SampleFeedback) => restoreAnalyses && !f.decided && !!savedAnalyses[f.ref];
  const rows = feedbackList.map((f) => ({
    ref: f.ref,
    cycle_id: cycle.id,
    tester_id: f.tester,
    step_id: f.step,
    text: f.text,
    reported_result: f.result,
    source: "tester_app",
    submitted_at: f.at,
    status: f.decided?.status ?? (restoring(f) ? "awaiting_review" : "new"),
    ticket_id: f.decided?.ticket ? ticketId.get(f.decided.ticket) ?? null : null,
    relation: f.decided?.relation ?? null,
    follow_up_question: f.decided?.question ?? null,
    tester_message: f.decided?.message ?? null,
    truth: f.truth,
  }));
  const inserted = must(
    await supabase.from("feedback").insert(rows).select("id, ref, status, ticket_id, submitted_at"),
    "insert feedback",
  ) as { id: string; ref: string; status: string; ticket_id: string | null; submitted_at: string }[];

  // History of human decisions for items decided before the demo starts (not the ones still waiting for review).
  const decisionRows = inserted
    .filter((f) => f.status !== "new" && f.status !== "awaiting_review")
    .map((f) => ({
      feedback_id: f.id,
      action: decisionAction(f.status),
      ticket_id: f.ticket_id,
      decided_by: MANAGER_ID,
      decided_at: new Date(new Date(f.submitted_at).getTime() + 3 * 60 * 60 * 1000).toISOString(),
      note: "Decided before AI triage was switched on.",
    }));
  if (decisionRows.length) {
    must(await supabase.from("decisions").insert(decisionRows).select("id"), "insert decisions");
  }

  // Restore saved AI analyses for pending reports, so the demo starts with suggestions ready
  // and resetting costs nothing. The last write of a reset.
  const restore = inserted.filter((f) => f.status === "awaiting_review" && savedAnalyses[f.ref]);
  if (restore.length) {
    must(
      await supabase
        .from("analyses")
        .insert(restore.map((f) => ({ ...savedAnalyses[f.ref], feedback_id: f.id })))
        .select("id"),
      "restore analyses",
    );
  }

  return { feedback: inserted.length, tickets: tickets.length };
}

/** The action that leaves a report in this status, as decide.ts records it, for the decisions made before the demo. */
function decisionAction(status: string): string {
  switch (status) {
    case "ticketed":
      return "create_ticket";
    case "linked":
      return "link_to_ticket";
    case "idea":
      return "add_to_ideas";
    case "needs_info":
      return "ask_tester";
    case "answered":
      return "answer";
    default:
      return "acknowledge";
  }
}
