/**
 * The database rows as the app reads them, one type per table (the tables are made in supabase/migrations). They are
 * written by hand and cast onto query results, so nothing checks them against the schema: a new column goes in both.
 * Two tables are typed elsewhere: analyses (AnalysisRow in queries.ts, the suggestion in ai/schema.ts) and ai_usage,
 * which only ai/budget.ts touches.
 */

export type Role = "tester" | "manager" | "developer";

export type Person = { id: string; name: string; role: Role; team: string };

/** One step of a test script, with what should happen. Its id is the script's id and the step number: "TS-04.3". */
export type Step = {
  id: string;
  script_id: string;
  step_no: number;
  instruction: string;
  expected: string;
};

export type Script = { id: string; cycle_id: string; title: string; area: string; sort: number };

/** Something the app does by design, or a known limit. The AI cites one by id when a report describes it (rule_id). */
export type AppRule = { id: string; cycle_id: string; rule: string };

/** One round of testing of one release; the app reads only one. app_name, name and app_description go to the AI. */
export type Cycle = {
  id: string;
  name: string;
  app_name: string;
  app_description: string;
  starts_on: string;
  ends_on: string;
};

export type TicketKind = "bug" | "idea";
export type Severity = "critical" | "high" | "medium" | "low";
/**
 * The developer moves a bug from open or planned to in_progress, then to fixed; reopening puts it back in progress.
 * Ideas never move. Nothing in the app sets planned or wont_fix: the sample's known issues start planned.
 */
export type TicketStatus = "open" | "in_progress" | "fixed" | "planned" | "wont_fix";

/** A bug or an idea (IDEA-01). origin known_issue: logged before this round of testing; cycle: opened from a report. */
export type Ticket = {
  id: string;
  key: string;
  cycle_id: string;
  kind: TicketKind;
  origin: "cycle" | "known_issue";
  title: string;
  summary: string;
  step_id: string | null;
  steps_to_reproduce: string[];
  expected: string | null;
  actual: string | null;
  severity: Severity | null;
  status: TicketStatus;
  status_note: string | null;
  created_by: string | null;
  created_at: string;
  /** The developer who has picked the ticket up. */
  assignee_id: string | null;
};

export type TicketEventKind = "picked_up" | "fixed" | "retest_passed" | "retest_failed" | "reopened";

/** Something a developer or a tester did to a ticket after it was approved. */
export type TicketEvent = {
  id: string;
  ticket_id: string;
  kind: TicketEventKind;
  /** The tester's report, for a retest result. */
  feedback_id: string | null;
  note: string | null;
  by_id: string | null;
  at: string;
};

/**
 * Where a report stands. new: waiting for the AI's suggestion; awaiting_review: the suggestion waits for the UAT manager;
 * needs_info: a question waits for the tester. The other five are decided (decide.ts).
 */
export type FeedbackStatus =
  | "new"
  | "awaiting_review"
  | "needs_info"
  | "linked"
  | "ticketed"
  | "idea"
  | "answered"
  | "acknowledged";

/** How a report on a ticket relates to it. origin: the ticket was opened from it; different_aspect: another symptom. */
export type Relation = "origin" | "exact_duplicate" | "different_aspect" | "related";

/** A sample report's labels, for the scripts that measure the AI. Null on real reports; never put in the prompt. */
export type Truth = {
  category: string;
  cluster: string | null;
  relation: string | null;
  evidence: string;
  severity?: string;
};

/**
 * A report, in the tester's own words (the table is feedback). follow_up_*: one question, from Review or the check
 * before sending, and the tester's answer; tester_message: the reply the tester sees once it is decided.
 */
export type Feedback = {
  id: string;
  ref: string;
  cycle_id: string;
  tester_id: string | null;
  step_id: string | null;
  text: string;
  reported_result: "pass" | "fail" | null;
  source: "tester_app" | "import";
  batch_id: string | null;
  submitted_at: string;
  status: FeedbackStatus;
  ticket_id: string | null;
  relation: Relation | null;
  follow_up_question: string | null;
  follow_up_answer: string | null;
  tester_message: string | null;
  truth: Truth | null;
};

/** One imported spreadsheet: its rows are the reports with its batch_id. Analysing until Import marks it done. */
export type Batch = {
  id: string;
  label: string;
  source_name: string | null;
  total: number;
  processed: number;
  status: "pending" | "analysing" | "done" | "failed";
  created_at: string;
};

/**
 * One person's decision on one report, never one for many. ai_action: the AI's suggestion as decisionKey writes it
 * ("link_to_ticket:MIA-101"); overridden: the person chose something else.
 */
export type Decision = {
  id: string;
  feedback_id: string;
  analysis_id: string | null;
  action: string;
  ai_action: string | null;
  overridden: boolean;
  ticket_id: string | null;
  note: string | null;
  decided_by: string | null;
  decided_at: string;
};
