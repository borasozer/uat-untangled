import type { Tone } from "@/components/badges";
import { firstName, TICKET_STATUS_LABEL } from "./labels";
import type { getTesterFeedback } from "./queries";

/** One of the tester's own reports, with where it has got to. */
export type MyFeedback = Awaited<ReturnType<typeof getTesterFeedback>>[number];

/**
 * The ticket this report is on has been fixed and this tester has not said yet whether it works. A tester with
 * several reports on one ticket is asked once, on the first of them.
 */
export const retestDue = (f: MyFeedback) => !!f.fix && !f.retest && f.retestRef === f.ref;

/** The tester has something to do: answer a question or retest a fix. */
export const yourTurn = (f: MyFeedback) => f.status === "needs_info" || retestDue(f);

export type ReportGroup = "turn" | "waiting" | "ticket" | "done";

/** The groups in "Your reports", in order. Roles, not names: a first-time visitor does not know who Grace is. */
export const GROUP_TITLE: Record<ReportGroup, string> = {
  turn: "Your turn",
  waiting: "Waiting for the UAT manager",
  ticket: "On a ticket",
  done: "Done",
};

/** Kept as an idea: the first to suggest it, or a report added to an idea someone already had. No developer waits on it. */
const keptAsIdea = (f: MyFeedback) => f.status === "idea" || f.ticket?.kind === "idea";

/** The tester answered a question from the UAT manager, and the report is back with the manager. */
const answerSent = (f: MyFeedback) => f.managerAsked && !!f.follow_up_answer;

/** Where a report goes in "Your reports". Done: kept as an idea, answered, thanked, confirmed fixed or won't fix. */
export function reportGroup(f: MyFeedback): ReportGroup {
  if (yourTurn(f)) return "turn";
  if (f.status === "new" || f.status === "awaiting_review") return "waiting";
  if (keptAsIdea(f) || f.status === "answered" || f.status === "acknowledged") return "done";
  if (f.confirmed || f.ticket?.status === "wont_fix") return "done";
  return "ticket";
}

/** The one label a card shows: where the report stands, in the tester's words. */
export function reportLabel(f: MyFeedback): { text: string; tone: Tone } {
  if (f.status === "needs_info") return { text: "Question for you", tone: "attention" };
  if (retestDue(f)) return { text: "Fixed: please check", tone: "attention" };
  switch (f.status) {
    case "new":
    case "awaiting_review":
      return { text: answerSent(f) ? "Answer sent" : "Not read yet", tone: "neutral" };
    case "answered":
      return { text: "Answered", tone: "neutral" };
    case "acknowledged":
      return { text: "Closed: no fix needed", tone: "neutral" };
  }
  if (keptAsIdea(f)) return { text: "Kept as an idea", tone: "neutral" };
  if (!f.ticket) return { text: "On a ticket", tone: "neutral" };
  const key = f.ticket.key;
  if (f.reopened) return { text: `Reopened: ${key}`, tone: "neutral" };
  if (f.fix) {
    if (f.confirmed) return { text: "Confirmed fixed", tone: "neutral" };
    if (f.retest) return f.retest.works ? { text: "Works for you", tone: "neutral" } : { text: "Still broken", tone: "failure" };
    return { text: `${key} fixed`, tone: "neutral" };
  }
  if (f.ticket?.status === "wont_fix") return { text: `${key}: won't fix`, tone: "neutral" };
  return { text: f.status === "ticketed" ? `New bug ${key}` : `Added to ${key}`, tone: "neutral" };
}

/**
 * One short line under the tester's words: what happens next, and who else reported it. Null where the card shows
 * something better instead (a question to answer, a retest, or the manager's reply when that reply is the outcome).
 */
export function nextLine(f: MyFeedback, names: Record<string, string>): string | null {
  if (f.status === "new" || f.status === "awaiting_review") {
    return answerSent(f) ? "Thanks for your answer. The UAT manager will reply here." : "The UAT manager will reply here.";
  }
  if (yourTurn(f) || f.status === "answered" || f.status === "acknowledged") return null;
  const others = f.othersOnTicket;
  if (keptAsIdea(f)) {
    return others > 0 ? `Kept for the product team · you + ${others} other tester${others === 1 ? "" : "s"}` : "Kept for the product team.";
  }
  const t = f.ticket;
  if (!t) return null;
  const who =
    others > 0
      ? `you + ${others} other tester${others === 1 ? "" : "s"}`
      : t.origin === "known_issue"
        ? "you confirm it still happens"
        : "only you so far";
  const developer = (t.assignee_id && names[t.assignee_id] && firstName(names[t.assignee_id])) || null;
  let what: string;
  if (f.reopened) what = `${developer ?? "The developer"} is on it again`;
  else if (f.fix) {
    if (f.confirmed) return "Every tester says it works now.";
    const othersBroken = f.fix.failed.length - (f.retest && !f.retest.works ? 1 : 0);
    if (f.retest && !f.retest.works) what = "The developer has been told";
    else if (othersBroken > 0) what = `${othersBroken === 1 ? "Another tester says" : `${othersBroken} testers say`} it is still broken`;
    else if (!f.retest) what = `Retest on ${f.retestRef}`;
    else if (f.notYet > 0) what = `${f.notYet} more tester${f.notYet === 1 ? "" : "s"} still to retest`;
    else what = "Fixed";
  } else if (t.origin === "known_issue") what = "Known before testing";
  else if (t.status === "in_progress") what = `${developer ?? "A developer"} is fixing it`;
  else if (t.status === "open") what = "Waiting for a developer";
  else what = TICKET_STATUS_LABEL[t.status];
  return `${what} · ${who}`;
}
