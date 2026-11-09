// End-to-end check of the decision flow and the developer's fix-and-retest loop against the real
// database, using saved analyses (no API calls). Resets the demo before and after.
// Usage: npm run smoke
import type { Analysis } from "../src/lib/ai/schema";
import { db } from "../src/lib/db";
import { decide } from "../src/lib/decide";
import { resetDemo, SEED_BASELINE } from "../src/lib/seed";
import { markFixed, pickUp, recordRetest, reopen } from "../src/lib/ticket-work";

const supabase = db();
let failures = 0;

function check(name: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}

async function item(ref: string) {
  const { data } = await supabase.from("feedback").select("*, tickets(key)").eq("ref", ref).single();
  const { data: a } = await supabase
    .from("analyses")
    .select("suggestion")
    .eq("feedback_id", data.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return { f: data, ai: (a?.suggestion ?? null) as Analysis | null };
}

async function lastDecision(feedbackId: string) {
  const { data } = await supabase
    .from("decisions")
    .select("*")
    .eq("feedback_id", feedbackId)
    .order("decided_at", { ascending: false })
    .limit(1)
    .single();
  return data;
}

async function main() {
  await resetDemo();
  const { count } = await supabase.from("feedback").select("id", { count: "exact", head: true }).eq("status", "awaiting_review");
  check(`reset restores ${SEED_BASELINE.analyses} analysed reports`, count === SEED_BASELINE.analyses, `got ${count}`);

  // 1. Approve the AI's new ticket as drafted.
  const fb21 = await item("FB-021");
  const d = fb21.ai!.draft_ticket!;
  const r1 = await decide(fb21.f.id, {
    action: "create_ticket",
    draft: { ...d, severity: d.severity ?? "medium" },
    testerMessage: fb21.ai!.tester_reply,
  });
  const after21 = await item("FB-021");
  check("create_ticket makes MIA-106", r1.ticketKey === "MIA-106", String(r1.ticketKey));
  check("report is ticketed and linked as origin", after21.f.status === "ticketed" && after21.f.relation === "origin");
  check("tester message has the real ticket key", !!after21.f.tester_message?.includes("MIA-106") && !after21.f.tester_message.includes("{ticket}"));
  check("approving the AI is not an override", (await lastDecision(fb21.f.id)).overridden === false);

  // 2. Approve a link exactly as suggested.
  const fb22 = await item("FB-022");
  await decide(fb22.f.id, {
    action: "link_to_ticket",
    ticketKey: fb22.ai!.match.target!,
    relation: "exact_duplicate",
    testerMessage: fb22.ai!.tester_reply,
  });
  const after22 = await item("FB-022");
  check("link attaches to MIA-101", after22.f.tickets?.key === "MIA-101" && after22.f.status === "linked");

  // 3. Overrule the AI: link an idea to an existing idea instead of creating a new one.
  const fb25 = await item("FB-025");
  await decide(fb25.f.id, {
    action: "link_to_ticket",
    ticketKey: "IDEA-01",
    relation: "exact_duplicate",
    testerMessage: "Thanks Priya. We added your report to {ticket}.",
  });
  check("overruling the AI is recorded as an override", (await lastDecision(fb25.f.id)).overridden === true);
  const after25 = await item("FB-025");
  check(
    "linking fills {ticket} with the chosen ticket",
    !!after25.f.tester_message?.includes("IDEA-01") && !after25.f.tester_message.includes("{ticket}"),
  );

  // 4. Ask the tester; the report stays open.
  const fb23 = await item("FB-023");
  await decide(fb23.f.id, { action: "ask_tester", question: fb23.ai!.follow_up_question! });
  const after23 = await item("FB-023");
  check("ask_tester keeps the report open as needs_info", after23.f.status === "needs_info" && !!after23.f.follow_up_question);

  // 5. A decided report cannot be decided twice.
  let blocked = false;
  try {
    await decide(fb21.f.id, { action: "acknowledge", testerMessage: "x" });
  } catch {
    blocked = true;
  }
  check("a decided report cannot be decided again", blocked);

  // 6. The developer's loop: pick up, mark fixed, the testers retest, reopen.
  const refused = async (fn: () => Promise<unknown>) => fn().then(() => false, () => true);
  check("a ticket already in progress cannot be picked up again", await refused(() => pickUp("MIA-101")));
  await pickUp("MIA-105");
  const { data: t105 } = await supabase.from("tickets").select("status, assignee_id").eq("key", "MIA-105").single();
  check("picking up sets owner and In progress", t105?.status === "in_progress" && t105?.assignee_id === "D1");
  check("an idea cannot be marked fixed", await refused(() => markFixed("IDEA-01", "")));
  const fixed = await markFixed("MIA-101", "Long enquiries are generated in parts.");
  check("marking fixed asks every tester on the ticket to retest", fixed.retesters === 5, `got ${fixed.retesters}`);
  const fb1 = await item("FB-001");
  await recordRetest(fb1.f.id, true, "");
  check("a tester cannot answer the same retest twice", await refused(() => recordRetest(fb1.f.id, false, "Still spins.")));
  // Priya reported MIA-102 twice (FB-004, FB-019): one retest answer from her, not two.
  const fixed102 = await markFixed("MIA-102", "");
  check("retesters are counted per person", fixed102.retesters === 2, `got ${fixed102.retesters}`);
  await recordRetest((await item("FB-004")).f.id, true, "");
  check(
    "a tester with two reports on a ticket answers the retest once",
    await refused(async () => recordRetest((await item("FB-019")).f.id, false, "Still opens page 1.")),
  );
  check("\"Still broken\" needs a line saying what happened", await refused(async () => recordRetest((await item("FB-005")).f.id, false, " ")));
  const { count: retests } = await supabase
    .from("ticket_events")
    .select("id", { count: "exact", head: true })
    .eq("kind", "retest_passed");
  check("each retest is recorded once (FB-001, FB-004)", retests === 2, `got ${retests}`);
  await reopen("MIA-101", "Still cut off near 1,800 characters.");
  const { data: t101 } = await supabase.from("tickets").select("status").eq("key", "MIA-101").single();
  check("reopening returns the ticket to In progress", t101?.status === "in_progress");
  const fb3 = await item("FB-003");
  check("no retest while the ticket is reopened", await refused(() => recordRetest(fb3.f.id, true, "")));

  await resetDemo();
  const { count: tickets } = await supabase.from("tickets").select("id", { count: "exact", head: true });
  check("reset returns to 10 tickets", tickets === 10, `got ${tickets}`);
  const { count: events } = await supabase.from("ticket_events").select("id", { count: "exact", head: true });
  check("reset returns the ticket history to the start", events === SEED_BASELINE.ticketEvents, `got ${events}`);

  console.log(failures ? `\n${failures} check(s) failed.` : "\nAll checks passed.");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
