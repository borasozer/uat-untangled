import { db, DbError, must } from "./db";
import { decisionKey, type Analysis } from "./ai/schema";
import { nextTicketKey } from "./ticket-key";
import type { Feedback, Severity, Ticket } from "./types";

/**
 * The one place a person's decision on a report is recorded: the UAT manager's approve or overrule in Review comes here
 * through decideAction (app/actions.ts). One report per call; there is deliberately no batch version. Only a report not yet
 * decided (new, awaiting review, or waiting for the tester's answer) can be decided. What each outcome does to it:
 *   create_ticket: a new bug ticket with the cycle's next key; the report becomes its first report.
 *   add_to_ideas: a new idea ticket, title and summary only; the report becomes its first report.
 *   link_to_ticket: no new ticket; the report joins an existing one, as the same problem or another symptom of it.
 *   ask_tester: the question goes to the tester, and the report stays in Review until the answer comes back.
 *   answer, acknowledge: the report is closed with a reply to the tester.
 * "{ticket}" in the tester's message becomes the real key. Every outcome also adds one row to decisions, with the AI's
 * latest suggestion beside it and whether the person changed it. Nothing in the AI code calls this.
 */

/** The UAT manager in the sample cycle. There is no sign-in, so every decision is recorded as theirs. */
export const MANAGER_ID = "M1";

/** The ticket as approved in Review: the AI's draft_ticket or the report's own words, after the manager's edits. */
export type TicketDraft = {
  title: string;
  summary: string;
  steps_to_reproduce: string[];
  expected: string;
  actual: string;
  severity: Severity | null;
};

/** What Review sends, one shape per action. A link is the same problem or another symptom, never only "related". */
export type DecisionInput =
  | { action: "create_ticket"; draft: TicketDraft; testerMessage: string }
  | { action: "add_to_ideas"; draft: Pick<TicketDraft, "title" | "summary">; testerMessage: string }
  | {
      action: "link_to_ticket";
      ticketKey: string;
      relation: "exact_duplicate" | "different_aspect";
      testerMessage: string;
    }
  | { action: "ask_tester"; question: string }
  | { action: "answer"; testerMessage: string }
  | { action: "acknowledge"; testerMessage: string };

/** The report's newest analysis; null if it has none, and then the decision is not counted as an overrule. */
type LatestAnalysis = { id: string; suggestion: Analysis } | null;

/**
 * Records one person's decision on one feedback item. There is deliberately no batch version.
 * Returns the ticket key when a ticket or idea was created or linked.
 */
export async function decide(
  feedbackId: string,
  input: DecisionInput,
  decidedBy = MANAGER_ID,
): Promise<{ ticketKey: string | null }> {
  const supabase = db();
  const feedback = must(
    await supabase.from("feedback").select("*").eq("id", feedbackId).single(),
    "load feedback",
  ) as Feedback;
  if (!["new", "awaiting_review", "needs_info"].includes(feedback.status)) {
    throw new Error(`${feedback.ref} has already been decided.`);
  }

  const analysisRes = await supabase
    .from("analyses")
    .select("id, suggestion")
    .eq("feedback_id", feedbackId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (analysisRes.error) throw new DbError(`load analysis: ${analysisRes.error.message}`);
  const analysis = analysisRes.data as LatestAnalysis;

  let ticket: Pick<Ticket, "id" | "key"> | null = null;
  let update: Partial<Feedback> = {};

  switch (input.action) {
    case "create_ticket": {
      ticket = await createTicket(feedback, "bug", input.draft, decidedBy);
      update = { status: "ticketed", ticket_id: ticket.id, relation: "origin", tester_message: fill(input.testerMessage, ticket.key) };
      break;
    }
    case "add_to_ideas": {
      ticket = await createTicket(
        feedback,
        "idea",
        { ...input.draft, steps_to_reproduce: [], expected: "", actual: "", severity: null },
        decidedBy,
      );
      update = { status: "idea", ticket_id: ticket.id, relation: "origin", tester_message: fill(input.testerMessage, ticket.key) };
      break;
    }
    case "link_to_ticket": {
      ticket = must(
        await supabase.from("tickets").select("id, key").eq("key", input.ticketKey).single(),
        `find ticket ${input.ticketKey}`,
      ) as Pick<Ticket, "id" | "key">;
      update = {
        status: "linked",
        ticket_id: ticket.id,
        relation: input.relation,
        tester_message: fill(input.testerMessage, ticket.key),
      };
      break;
    }
    case "ask_tester":
      update = { status: "needs_info", follow_up_question: input.question, follow_up_answer: null, tester_message: null };
      break;
    case "answer":
      update = { status: "answered", tester_message: input.testerMessage };
      break;
    case "acknowledge":
      update = { status: "acknowledged", tester_message: input.testerMessage };
      break;
  }

  must(await supabase.from("feedback").update(update).eq("id", feedbackId).select("id"), "update feedback");

  const aiKey = analysis ? decisionKey(analysis.suggestion) : null;
  const aiResolved = analysis ? await resolveAiKey(analysis.suggestion) : null;
  const humanKey = input.action === "link_to_ticket" ? `link_to_ticket:${input.ticketKey}` : input.action;
  must(
    await supabase
      .from("decisions")
      .insert({
        feedback_id: feedbackId,
        analysis_id: analysis?.id ?? null,
        action: input.action,
        ai_action: aiKey,
        overridden: aiResolved !== null && aiResolved !== humanKey,
        ticket_id: ticket?.id ?? null,
        decided_by: decidedBy,
      })
      .select("id"),
    "record decision",
  );

  return { ticketKey: ticket?.key ?? null };
}

/**
 * The AI may have pointed at a pending report that has since become a ticket.
 * Resolve that to the ticket key, so following the AI's suggestion does not count as an override.
 */
export async function resolveAiKey(ai: Analysis): Promise<string> {
  const key = decisionKey(ai);
  const target = ai.match.target;
  if (ai.suggested_action !== "link_to_ticket" || !target || !isFeedbackRef(target)) return key;
  const res = await db().from("feedback").select("ticket_id, tickets(key)").eq("ref", target).maybeSingle();
  const ticketKey = (res.data as { tickets: { key: string } | null } | null)?.tickets?.key;
  return ticketKey ? `link_to_ticket:${ticketKey}` : key;
}

export function isFeedbackRef(target: string): boolean {
  return /^(FB|IMP|TR)-/i.test(target);
}

function fill(message: string, key: string): string {
  return message.replaceAll("{ticket}", key);
}

/** A new open ticket with the cycle's next key (ticket-key.ts), from the approved draft; an idea gets no severity. */
async function createTicket(
  feedback: Feedback,
  kind: "bug" | "idea",
  draft: TicketDraft,
  createdBy: string,
): Promise<Pick<Ticket, "id" | "key">> {
  const supabase = db();
  const keys = must(
    await supabase.from("tickets").select("key, kind").eq("cycle_id", feedback.cycle_id),
    "load ticket keys",
  ) as { key: string; kind: "bug" | "idea" }[];
  const key = nextTicketKey(keys, kind);

  return must(
    await supabase
      .from("tickets")
      .insert({
        key,
        cycle_id: feedback.cycle_id,
        kind,
        origin: "cycle",
        title: draft.title,
        summary: draft.summary,
        step_id: feedback.step_id,
        steps_to_reproduce: draft.steps_to_reproduce,
        expected: draft.expected || null,
        actual: draft.actual || null,
        severity: kind === "bug" ? draft.severity : null,
        status: "open",
        created_by: createdBy,
      })
      .select("id, key")
      .single(),
    "create ticket",
  ) as Pick<Ticket, "id" | "key">;
}
