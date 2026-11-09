import { db, must } from "../db";
import type { AppRule, Cycle, Feedback, Person, Script, Step, Ticket } from "../types";

/**
 * What the AI knows about the test cycle: its rules, the test scripts and steps, the people, every ticket with its first
 * reports, and the reports still waiting for a decision. Read from the database before every AI call the website makes,
 * so each analysis sees the tickets and decisions made a moment ago; prompt.ts turns it into text. Nothing here writes.
 */

export type TriageContext = {
  cycle: Cycle;
  rules: AppRule[];
  scripts: Script[];
  steps: Step[];
  people: Person[];
  tickets: Ticket[];
  /** Up to three reports already attached to each ticket, to show how testers describe it. */
  examplesByTicket: Map<string, string[]>;
  /** Reports not yet decided by a person (possible future tickets), including ones still being analysed. */
  pending: Feedback[];
};

/**
 * Reads the first cycle, then its rules, steps, people, tickets and waiting reports at once. Throws, saying what to do,
 * if there is no cycle.
 */
export async function loadContext(cycleId?: string): Promise<TriageContext> {
  const supabase = db();
  // One cycle at a time (README, Limitations): only the first cycle is read, so `cycleId` cannot pick another.
  const cycles = must(await supabase.from("cycles").select("*").limit(1), "load cycle") as Cycle[];
  const cycle = cycleId ? cycles.find((c) => c.id === cycleId) ?? cycles[0] : cycles[0];
  if (!cycle) throw new Error("No UAT cycle found. Use Start the demo over at the bottom of any page first.");

  const [rules, scripts, steps, people, tickets, linked, pending] = await Promise.all([
    supabase.from("app_rules").select("*").eq("cycle_id", cycle.id).order("id"),
    supabase.from("scripts").select("*").eq("cycle_id", cycle.id).order("sort"),
    supabase.from("steps").select("*").order("id"),
    supabase.from("people").select("*"),
    supabase.from("tickets").select("*").eq("cycle_id", cycle.id).order("key"),
    supabase
      .from("feedback")
      .select("ticket_id, text, submitted_at")
      .eq("cycle_id", cycle.id)
      .not("ticket_id", "is", null)
      .order("submitted_at")
      .order("ref"),
    supabase
      .from("feedback")
      .select("*")
      .eq("cycle_id", cycle.id)
      .in("status", ["new", "awaiting_review"])
      .order("submitted_at")
      .order("ref"),
  ]);

  const examplesByTicket = new Map<string, string[]>();
  for (const row of must(linked, "load linked feedback") as { ticket_id: string; text: string }[]) {
    const list = examplesByTicket.get(row.ticket_id) ?? [];
    if (list.length < 3) list.push(row.text);
    examplesByTicket.set(row.ticket_id, list);
  }

  return {
    cycle,
    rules: must(rules, "load rules") as AppRule[],
    scripts: must(scripts, "load scripts") as Script[],
    steps: must(steps, "load steps") as Step[],
    people: must(people, "load people") as Person[],
    tickets: must(tickets, "load tickets") as Ticket[],
    examplesByTicket,
    pending: must(pending, "load pending feedback") as Feedback[],
  };
}
