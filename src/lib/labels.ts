import type { Action, Category, MatchRelation } from "./ai/schema";
import type { Relation, Severity, TicketStatus } from "./types";

/** What the manager can do with a report. The keys are what the AI returns, so only the wording changes here. */
export const ACTION_LABEL: Record<Action, string> = {
  create_ticket: "New bug ticket",
  link_to_ticket: "Add to a ticket",
  add_to_ideas: "New idea",
  ask_tester: "Ask for details",
  answer: "Explain & close",
  acknowledge: "Thank & close",
};

/**
 * The two kinds of outcome: work for the developers, or a reply to the tester with no ticket. `short` names the row of
 * choices where the decision is made.
 */
export const ACTION_GROUPS: {
  id: "work" | "talk";
  label: (name: string) => string;
  short: string;
  sub: string;
  actions: Action[];
}[] = [
  {
    id: "work",
    label: () => "Becomes work",
    short: "Ticket",
    sub: "ticket or idea",
    actions: ["create_ticket", "link_to_ticket", "add_to_ideas"],
  },
  {
    id: "talk",
    label: (name) => `Reply to ${name}`,
    short: "No ticket",
    sub: "no ticket",
    actions: ["ask_tester", "answer", "acknowledge"],
  },
];

/** One line on what each choice does, shown under the choices. */
export const ACTION_HINT: Record<Action, (name: string) => string> = {
  create_ticket: () => "Opens a new bug ticket for the developers; this report is its first.",
  link_to_ticket: () => "No new ticket: the report joins a ticket that already exists.",
  add_to_ideas: () => "Not a defect: it goes on the ideas backlog for the product team.",
  ask_tester: (name) => `Sends ${name} one question; the answer comes back for a new AI review.`,
  answer: (name) => `A question, or it works as designed: tell ${name} why, and close.`,
  acknowledge: (name) => `Nothing to fix, such as a step that passed: thank ${name}, and close.`,
};

/** A decision in the past tense, for a ticket's evidence and history: "Added to this ticket by Grace Liu". */
export const ACTION_DONE: Record<Action, { by: string; did: string }> = {
  create_ticket: { by: "Ticket created by", did: "created the ticket from" },
  link_to_ticket: { by: "Added by", did: "added" },
  add_to_ideas: { by: "Idea created by", did: "created the idea from" },
  ask_tester: { by: "Question asked by", did: "asked about" },
  answer: { by: "Answered by", did: "answered" },
  acknowledge: { by: "Thanked by", did: "thanked the tester for" },
};

/**
 * The four kinds of comment a UAT manager sorts (same bug, thin evidence, a good idea, already known) and the cases
 * around them. Worked out from the outcome and the ticket it points at, never asked of the AI.
 */
export type Bucket =
  | "same_bug"
  | "other_symptom"
  | "already_known"
  | "thin_evidence"
  | "idea"
  | "new_bug"
  | "by_design"
  | "question"
  | "nothing_to_fix";

export const BUCKET_LABEL: Record<Bucket, string> = {
  same_bug: "Same bug",
  other_symptom: "Other symptom",
  already_known: "Already known",
  thin_evidence: "Thin evidence",
  idea: "Good idea",
  new_bug: "New bug",
  by_design: "Works as designed",
  question: "A question",
  nothing_to_fix: "Nothing to fix",
};

/** The bucket an AI suggestion puts a report in (Review, the import summary). Joining a known issue: already_known. */
export function bucketOf(o: {
  action: Action;
  relation?: MatchRelation | Relation | null;
  /** Where the ticket it joins came from: known before testing, or found in this round. */
  targetOrigin?: "cycle" | "known_issue" | null;
  /** The kind of ticket it joins; unknown when the match is another report, not a ticket yet. */
  targetKind?: "bug" | "idea" | null;
  category?: Category | null;
}): Bucket {
  switch (o.action) {
    case "link_to_ticket":
      if (o.targetOrigin === "known_issue") return "already_known";
      // Joining an idea someone already had: still a good idea, not a bug. The ticket's kind decides; the AI's reading
      // of the report only when the match is another report.
      if ((o.targetKind ?? (o.category === "idea" ? "idea" : "bug")) === "idea") return "idea";
      return o.relation === "different_aspect" ? "other_symptom" : "same_bug";
    case "create_ticket":
      return "new_bug";
    case "ask_tester":
      return "thin_evidence";
    case "add_to_ideas":
      return "idea";
    case "answer":
      return o.category === "question" ? "question" : "by_design";
    case "acknowledge":
      return "nothing_to_fix";
  }
}

/** A report's ref (FB-, IMP-, TR-), not a ticket key: the AI may match a report that is not a ticket yet. */
const isReportRef = (key: string | null | undefined): key is string => !!key && /^(FB|IMP|TR)-/i.test(key);

/**
 * The bucket and the ticket it points at, short enough for a queue row: "Same bug · MIA-101", "Already known ·
 * MIA-090". Another report that is not a ticket yet is named as a match: "Same bug as FB-021".
 */
export function bucketLine(bucket: Bucket, key?: string | null): string {
  if (isReportRef(key)) {
    if (bucket === "same_bug" || bucket === "other_symptom") return `${BUCKET_LABEL[bucket]} as ${key}`;
    if (bucket === "idea") return `Good idea · like ${key}`;
  }
  if (key && (bucket === "same_bug" || bucket === "other_symptom" || bucket === "already_known" || bucket === "idea")) {
    return `${BUCKET_LABEL[bucket]} · ${key}`;
  }
  return BUCKET_LABEL[bucket];
}

/**
 * The AI's suggestion as a headline: the bucket, then what to do about it ("New bug" · "open a ticket", "Thin
 * evidence" · "ask Hannah first"). The words a UAT manager sorts by come first.
 */
export function bucketHeadline(bucket: Bucket, key: string | null | undefined, name: string): { title: string; action: string | null } {
  if (isReportRef(key) && (bucket === "same_bug" || bucket === "other_symptom" || bucket === "idea")) {
    return { title: bucketLine(bucket, key), action: null };
  }
  switch (bucket) {
    case "new_bug":
      return { title: BUCKET_LABEL[bucket], action: "open a ticket" };
    case "same_bug":
    case "other_symptom":
      return { title: BUCKET_LABEL[bucket], action: key ? `add to ${key}` : "add to a ticket" };
    case "already_known":
      return { title: BUCKET_LABEL[bucket], action: key ? `link ${key}` : "link the known issue" };
    case "thin_evidence":
      return { title: BUCKET_LABEL[bucket], action: `ask ${name} first` };
    case "idea":
      return { title: BUCKET_LABEL[bucket], action: key ? `add to ${key}` : "keep it as an idea" };
    case "by_design":
    case "question":
      return { title: BUCKET_LABEL[bucket], action: `explain to ${name}` };
    case "nothing_to_fix":
      return { title: BUCKET_LABEL[bucket], action: `thank ${name}` };
  }
}

export const EVIDENCE_LABEL: Record<"complete" | "partial" | "insufficient", string> = {
  complete: "Enough detail",
  partial: "Some detail missing",
  insufficient: "Too little detail",
};

export const RELATION_LABEL: Record<MatchRelation | Relation, string> = {
  exact_duplicate: "Same problem",
  different_aspect: "Other symptom",
  related: "Related, different problem",
  none: "No match",
  origin: "First report",
};

export const TICKET_STATUS_LABEL: Record<TicketStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  fixed: "Fixed",
  planned: "Planned",
  wont_fix: "Won't fix",
};

/** An idea is not fixed or closed: it waits on the backlog, is planned, or is not taken up. */
const IDEA_STATUS_LABEL: Partial<Record<TicketStatus, string>> = { open: "In backlog", planned: "Planned", wont_fix: "Not planned" };

/** A ticket's status in words; an idea's in the backlog's words. */
export function ticketStatusLabel(status: TicketStatus, kind: "bug" | "idea" = "bug"): string {
  return kind === "idea" ? (IDEA_STATUS_LABEL[status] ?? "In backlog") : TICKET_STATUS_LABEL[status];
}

/** Where a retest stands: "2 work now · 1 still broken · 1 not yet", leaving out what is zero. */
export function retestTally(passed: number, failed: number, notYet: number): string {
  const parts = [
    passed ? `${passed} work${passed === 1 ? "s" : ""} now` : null,
    failed ? `${failed} still broken` : null,
    notYet ? `${notYet} not yet` : null,
  ].filter(Boolean);
  return parts.join(" · ") || "no answers yet";
}

/** How a report on a ticket relates to it, in the words Review uses: "Same bug" on a bug, "Same idea" on an idea. */
export function relationLabel(relation: Relation, kind: "bug" | "idea"): string {
  if (relation === "exact_duplicate") return kind === "idea" ? "Same idea" : "Same bug";
  if (relation === "different_aspect") return kind === "idea" ? "Related idea" : "Other symptom";
  return RELATION_LABEL[relation];
}

export const SEVERITY_LABEL: Record<Severity, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

/** The first name for friendly lines: "Dr James Whitfield" gives "James"; "there" when no name is known. */
export function firstName(name: string | undefined | null): string {
  if (!name) return "there";
  const parts = name.replace(/^Dr\.?\s+/i, "").split(/\s+/);
  return parts[0];
}

/** "29 Oct": the day only, for places with little room. */
export function formatDay(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "Europe/London" }).format(new Date(iso));
}

/** A cycle's dates: "26 Oct – 6 Nov". */
export function formatSpan(from: string, to: string): string {
  const day = (d: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(d));
  return `${day(from)} – ${day(to)}`;
}

/** The first sentence of a longer description, for a one-line summary. */
export function firstSentence(text: string): string {
  const m = /^[\s\S]*?[.!?](?=\s|$)/.exec(text.trim());
  return (m ? m[0] : text).trim();
}

/** "29 Oct, 14:05": the day and time something happened, on London's clock. */
export function formatWhen(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/London",
  }).format(new Date(iso));
}
