import { db, must } from "./db";
import type { Feedback, Ticket, TicketEvent } from "./types";

/** The developer in this demo. */
export const DEVELOPER_ID = "D1";

/**
 * The developer's side of a ticket, after a person approved it: pick it up, mark it fixed, reopen it.
 * And the tester's side: retest a fixed ticket and say whether it works now.
 * Each function is one person's action on one ticket. Nothing here runs by itself or for many tickets at once.
 */

type TicketRow = Pick<Ticket, "id" | "key" | "kind" | "origin" | "status" | "assignee_id">;

/** The ticket a button acts on. Throws if it does not exist, or if it is an idea: ideas are not picked up or fixed. */
async function loadTicket(key: string): Promise<TicketRow> {
  const t = (await db().from("tickets").select("id, key, kind, origin, status, assignee_id").eq("key", key).maybeSingle())
    .data as TicketRow | null;
  if (!t) throw new Error(`${key} does not exist.`);
  if (t.kind !== "bug") throw new Error(`${key} is an idea, not a bug to fix.`);
  return t;
}

async function addEvent(event: Omit<TicketEvent, "id" | "at">) {
  must(await db().from("ticket_events").insert(event).select("id"), "record ticket event");
}

/** Only change a ticket that is still in the state the button was shown for, so two people cannot clash. */
async function moveTicket(t: TicketRow, from: Ticket["status"][], update: Partial<Ticket>) {
  const rows = must(
    await db().from("tickets").update(update).eq("id", t.id).in("status", from).select("id"),
    "update ticket",
  ) as { id: string }[];
  if (rows.length === 0) throw new Error(`${t.key} has changed in the meantime. Reload the page.`);
}

/** The developer starts on an open or planned ticket: it becomes in progress and assigned to them. */
export async function pickUp(key: string, by = DEVELOPER_ID): Promise<void> {
  const t = await loadTicket(key);
  if (t.status !== "open" && t.status !== "planned") throw new Error(`${key} is already being worked on.`);
  await moveTicket(t, ["open", "planned"], { status: "in_progress", assignee_id: by });
  await addEvent({ ticket_id: t.id, kind: "picked_up", feedback_id: null, note: null, by_id: by });
}

/**
 * The ticket's status note is shown to testers and read by the AI with the ticket, so it only ever holds a fixed
 * sentence. What the developer writes stays on the ticket event, where the developer and the testers see it. The
 * developer's own page shows the state in its panel, not these sentences.
 */
export const FIXED_NOTE = "Fixed, waiting for the testers to retest.";
export const REOPENED_NOTE = "Reopened: the developer is working on it again.";

/** Marks the ticket fixed; every tester who reported it is then asked to retest. */
export async function markFixed(key: string, note: string, by = DEVELOPER_ID): Promise<{ retesters: number }> {
  const t = await loadTicket(key);
  if (t.status !== "in_progress" && t.status !== "open") throw new Error(`${key} is not open, so it cannot be marked fixed.`);
  const clean = note.trim().slice(0, 500) || null;
  await moveTicket(t, ["in_progress", "open"], {
    status: "fixed",
    assignee_id: t.assignee_id ?? by,
    status_note: FIXED_NOTE,
  });
  await addEvent({ ticket_id: t.id, kind: "fixed", feedback_id: null, note: clean, by_id: by });
  const reports = must(
    await db().from("feedback").select("tester_id").eq("ticket_id", t.id),
    "load reports",
  ) as { tester_id: string | null }[];
  return { retesters: new Set(reports.map((r) => r.tester_id).filter(Boolean)).size };
}

/** Back to work, for example after a tester says it still fails. */
export async function reopen(key: string, note: string, by = DEVELOPER_ID): Promise<void> {
  const t = await loadTicket(key);
  if (t.status !== "fixed") throw new Error(`${key} is not marked fixed.`);
  const clean = note.trim().slice(0, 500) || null;
  await moveTicket(t, ["fixed"], { status: "in_progress", status_note: REOPENED_NOTE });
  await addEvent({ ticket_id: t.id, kind: "reopened", feedback_id: null, note: clean, by_id: by });
}

/** A tester's retest of a fixed ticket, recorded against their own report. One answer per tester per fix. */
export async function recordRetest(feedbackId: string, works: boolean, note: string): Promise<{ ticketKey: string }> {
  // "Still broken" with nothing else is the vague report the developer cannot act on.
  if (!works && !note.trim()) throw new Error("Say what happened this time, so the developer can act on it.");
  const supabase = db();
  const f = (await supabase.from("feedback").select("id, ticket_id, tester_id").eq("id", feedbackId).maybeSingle())
    .data as Pick<Feedback, "id" | "ticket_id" | "tester_id"> | null;
  if (!f?.ticket_id) throw new Error("This report is not on a ticket.");
  const t = (await supabase.from("tickets").select("id, key, status").eq("id", f.ticket_id).maybeSingle()).data as Pick<
    Ticket,
    "id" | "key" | "status"
  > | null;
  if (!t || t.status !== "fixed") throw new Error("This ticket is not waiting for a retest.");
  const since = await lastFixedAt(t.id);
  // A tester with two reports on the ticket still answers once: the fix either works for them or it does not.
  const earlier = supabase
    .from("ticket_events")
    .select("id")
    .eq("ticket_id", t.id)
    .in("kind", ["retest_passed", "retest_failed"])
    .gte("at", since ?? "1970-01-01");
  const already = must(
    await (f.tester_id ? earlier.eq("by_id", f.tester_id) : earlier.eq("feedback_id", f.id)),
    "check earlier retest",
  ) as { id: string }[];
  if (already.length) throw new Error("You have already sent a retest result for this fix.");
  await addEvent({
    ticket_id: t.id,
    kind: works ? "retest_passed" : "retest_failed",
    feedback_id: f.id,
    note: note.trim().slice(0, 500) || null,
    by_id: f.tester_id,
  });
  return { ticketKey: t.key };
}

/** When the ticket was last marked fixed, or null. Retest answers from before then were about an earlier fix. */
async function lastFixedAt(ticketId: string): Promise<string | null> {
  const row = (
    await db()
      .from("ticket_events")
      .select("at")
      .eq("ticket_id", ticketId)
      .eq("kind", "fixed")
      .order("at", { ascending: false })
      .limit(1)
      .maybeSingle()
  ).data as { at: string } | null;
  return row?.at ?? null;
}

/** Where a ticket stands since it was last marked fixed: who fixed it, and what the testers said. */
export type FixState = {
  fixedAt: string;
  fixedBy: string | null;
  note: string | null;
  passed: { feedbackId: string | null; by: string | null; at: string; note: string | null }[];
  failed: { feedbackId: string | null; by: string | null; at: string; note: string | null }[];
};

/** FixState from a ticket's history; null if it was never marked fixed. Only the events since the last fix count. */
export function fixState(events: TicketEvent[]): FixState | null {
  const sorted = [...events].sort((a, b) => a.at.localeCompare(b.at));
  const fixIdx = sorted.map((e) => e.kind).lastIndexOf("fixed");
  if (fixIdx < 0) return null;
  const fix = sorted[fixIdx];
  // Each tester's first answer since the fix counts. recordRetest refuses a second one, but two at the same moment
  // can both be written (there is no unique index); only the first is kept here.
  const seen = new Set<string>();
  const answers = sorted.slice(fixIdx + 1).filter((e) => {
    if (e.kind !== "retest_passed" && e.kind !== "retest_failed") return false;
    const who = e.by_id ?? `report:${e.feedback_id}`;
    if (seen.has(who)) return false;
    seen.add(who);
    return true;
  });
  const pick = (kind: TicketEvent["kind"]) =>
    answers.filter((e) => e.kind === kind).map((e) => ({ feedbackId: e.feedback_id, by: e.by_id, at: e.at, note: e.note }));
  return { fixedAt: fix.at, fixedBy: fix.by_id, note: fix.note, passed: pick("retest_passed"), failed: pick("retest_failed") };
}

/**
 * Every tester who can be asked to retest says it works now, and nothing new was reported since the fix. Shown, never
 * acted on: the ticket stays as a person left it. A report with no known tester cannot be retested, so it does not count.
 */
export function isConfirmed(fix: FixState | null, reports: { tester_id: string | null; submitted_at: string }[]): boolean {
  if (!fix || fix.failed.length > 0 || reports.some((r) => r.submitted_at > fix.fixedAt)) return false;
  const testers = new Set(reports.map((r) => r.tester_id).filter((id): id is string => !!id));
  const passed = new Set(fix.passed.map((p) => p.by));
  return testers.size > 0 && [...testers].every((id) => passed.has(id));
}

/** Testers who can retest a ticket and have not answered since the fix. */
export function notYetRetested(fix: FixState | null, reports: { tester_id: string | null }[]): number {
  if (!fix) return 0;
  const answered = new Set([...fix.passed, ...fix.failed].map((a) => a.by));
  return new Set(reports.map((r) => r.tester_id).filter((id): id is string => !!id && !answered.has(id))).size;
}

/** Why the ticket was last reopened, if that is the latest thing that happened to it. */
export function reopenReason(events: TicketEvent[]): { at: string; note: string | null } | null {
  const last = [...events].sort((a, b) => a.at.localeCompare(b.at)).at(-1);
  return last?.kind === "reopened" ? { at: last.at, note: last.note } : null;
}

/**
 * A ticket that was reopened after its fix, as the developer needs it while working on it again: why it was reopened,
 * and what the testers who found it still broken said.
 */
export function reopenState(events: TicketEvent[]): { at: string; note: string | null; failed: FixState["failed"] } | null {
  const reason = reopenReason(events);
  return reason ? { ...reason, failed: fixState(events)?.failed ?? [] } : null;
}
