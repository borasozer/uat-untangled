"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { after } from "next/server";
import { analyseAndStore } from "@/lib/ai/analyse";
import { ANALYSIS_ESTIMATE_USD, assertBudget, clientId, FAILED_CALL_ESTIMATE_USD, recordUsage } from "@/lib/ai/budget";
import { loadContext } from "@/lib/ai/context";
import { checkEvidence, type EvidenceCheck } from "@/lib/ai/evidence";
import { parseCsv } from "@/lib/csv";
import { db, DbError, must } from "@/lib/db";
import { decide, type DecisionInput } from "@/lib/decide";
import { startOver, type StartOverResult } from "@/lib/demo";
import { importCsv, type ImportPreview } from "@/lib/importer";
import { markFixed, pickUp, recordRetest, reopen } from "@/lib/ticket-work";
import { getBatchSummary, type BatchSummary } from "@/lib/queries";
import type { Person } from "@/lib/types";

/**
 * The server actions: every button that changes the shared demo calls one of these (the import screen also calls
 * src/app/api/analyse/route.ts for each row). There is no sign-in, so any visitor can call any of them: they refuse what
 * they cannot act on (too long, already decided, changed meanwhile), and every AI call is first checked against the spend
 * budget (src/lib/ai/budget.ts). The work itself is done in src/lib; afterwards every page is refreshed. Each returns a
 * Result instead of throwing (attempt), so the page can say what went wrong.
 *
 * Tester (New report, Your reports):
 *   checkEvidenceAction: the quick check on Send report (src/lib/ai/evidence.ts). It saves nothing but its cost.
 *   submitFeedbackAction: saves the report as the next FB number and analyses it after the response has gone back.
 *   answerFollowUpAction: saves the tester's answer to the UAT manager's question, then analyses the report again.
 *   retestAction: "It works now" or "Still broken" on a fixed ticket, recorded against the tester's report.
 * UAT manager (Review, Import):
 *   decideAction: the manager's decision on one report (src/lib/decide.ts). There is no batch version.
 *   reanalyseAction: Review's retry for a report whose analysis did not finish; refused once it has a suggestion.
 *   importCsvAction: checks the budget for every row, then saves the spreadsheet's rows as new reports, not analysed yet.
 *   finishBatchAction: marks an import finished and says what its rows became.
 * Developer (Tickets):
 *   pickUpAction, markFixedAction, reopenAction: pick up, mark fixed, reopen one ticket (src/lib/ticket-work.ts).
 * Anyone:
 *   startOverAction: "Start the demo over", at the bottom of every page (src/lib/demo.ts).
 */

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

/** Runs the work and turns a throw into { ok: false } with a message the page can show. */
async function attempt<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    console.error(e);
    // Database messages are for the log; everything else is written for the person reading it.
    const plain = e instanceof Error && !(e instanceof DbError);
    return { ok: false, error: plain ? e.message : "Something went wrong. Reload the page and try again." };
  }
}

/** Marks every page stale (the root layout and all below it), so a change made on one screen shows on the others. */
function refreshAll() {
  revalidatePath("/", "layout");
}

/** The visitor, for the AI spend budget (see src/lib/ai/budget.ts). */
async function visitor(): Promise<string> {
  return clientId(await headers());
}

/** Anyone can start the shared demo over (see src/lib/demo.ts). */
export async function startOverAction(): Promise<Result<StartOverResult>> {
  return attempt(async () => {
    const done = await startOver();
    refreshAll();
    return done;
  });
}

/** The UAT manager's decision on one report in Review; returns the ticket key when one was created or joined. */
export async function decideAction(
  feedbackId: string,
  input: DecisionInput,
): Promise<Result<{ ticketKey: string | null }>> {
  return attempt(async () => {
    // What a person writes here goes into every later AI call (tickets and messages are its context): keep it bounded.
    if (JSON.stringify(input).length > 20_000) throw new Error("This decision is too long to save. Please shorten the ticket or the message.");
    const r = await decide(feedbackId, input);
    refreshAll();
    return r;
  });
}

/** Analyses a report that has no suggestion yet (for example after a failed attempt). */
export async function reanalyseAction(feedbackId: string): Promise<Result<string>> {
  return attempt(async () => {
    const { data } = await db().from("feedback").select("status").eq("id", feedbackId).maybeSingle();
    if (data?.status !== "new") throw new Error("This report already has a suggestion, or is waiting for the tester.");
    const id = await analyseAndStore(feedbackId, { client: await visitor() });
    refreshAll();
    return id;
  });
}

/** The quick check on Send report. Saves only its cost to the budget ledger, a high estimate if the call fails. */
export async function checkEvidenceAction(input: {
  testerId: string;
  stepId: string | null;
  result: "pass" | "fail" | null;
  text: string;
}): Promise<Result<EvidenceCheck>> {
  return attempt(async () => {
    if (input.text.trim().length < 2) throw new Error("Please describe what happened.");
    if (input.text.length > 4000) throw new Error("Please keep the report under 4,000 characters.");
    const client = await visitor();
    await assertBudget(client, FAILED_CALL_ESTIMATE_USD.evidence_check);
    const ctx = await loadContext();
    const tester = ctx.people.find((p) => p.id === input.testerId);
    try {
      const { check, costUsd } = await checkEvidence(ctx, { ...input, testerName: tester?.name ?? "there" });
      await recordUsage("evidence_check", client, costUsd);
      return check;
    } catch (e) {
      await recordUsage("evidence_check", client, null, false);
      throw e;
    }
  });
}

/** Saves a new report as the next FB number; the quick check's question is kept only if the tester answered it. */
export async function submitFeedbackAction(input: {
  testerId: string;
  stepId: string | null;
  result: "pass" | "fail" | null;
  text: string;
  followUpQuestion?: string | null;
  followUpAnswer?: string | null;
}): Promise<Result<{ ref: string }>> {
  return attempt(async () => {
    const text = input.text.trim();
    if (text.length < 2) throw new Error("Please describe what happened.");
    if (text.length > 4000) throw new Error("Please keep the report under 4,000 characters.");
    const client = await visitor();
    await assertBudget(client, ANALYSIS_ESTIMATE_USD);
    const supabase = db();
    const tester = must(
      await supabase.from("people").select("*").eq("id", input.testerId).single(),
      "find tester",
    ) as Person;
    const cycle = must(await supabase.from("cycles").select("id").limit(1).single(), "load cycle") as { id: string };
    const refs = must(await supabase.from("feedback").select("ref").like("ref", "FB-%"), "load refs") as { ref: string }[];
    const next = refs.reduce((m, r) => Math.max(m, Number(r.ref.slice(3)) || 0), 0) + 1;
    const ref = `FB-${String(next).padStart(3, "0")}`;

    const answered = input.followUpQuestion && input.followUpAnswer?.trim();
    const row = must(
      await supabase
        .from("feedback")
        .insert({
          ref,
          cycle_id: cycle.id,
          tester_id: tester.id,
          step_id: input.stepId,
          text,
          reported_result: input.result,
          source: "tester_app",
          status: "new",
          follow_up_question: answered ? input.followUpQuestion : null,
          follow_up_answer: answered ? input.followUpAnswer!.trim() : null,
        })
        .select("id")
        .single(),
      "save feedback",
    ) as { id: string };

    // The tester is not kept waiting for the three AI runs: they start after the response has gone. If they fail, the
    // report stays new and Review offers to try again (reanalyseAction).
    after(async () => {
      try {
        await analyseAndStore(row.id, { client });
      } catch (e) {
        console.error(`Analysis failed for ${ref}`, e);
      }
    });
    refreshAll();
    return { ref };
  });
}

/** Saves the tester's answer only while the report is still waiting for it, then has the report analysed again. */
export async function answerFollowUpAction(feedbackId: string, answer: string): Promise<Result<null>> {
  return attempt(async () => {
    const text = answer.trim();
    if (!text) throw new Error("Please write an answer.");
    if (text.length > 2000) throw new Error("Please keep the answer under 2,000 characters.");
    const client = await visitor();
    await assertBudget(client, ANALYSIS_ESTIMATE_USD);
    const saved = must(
      await db()
        .from("feedback")
        .update({ follow_up_answer: text, status: "new" })
        .eq("id", feedbackId)
        .eq("status", "needs_info")
        .select("id"),
      "save answer",
    ) as { id: string }[];
    // Already answered, or closed in the meantime: nothing was saved, so nothing is analysed (and paid for) again.
    if (saved.length === 0) throw new Error("This question has already been answered or closed. Reload the page.");
    after(async () => {
      try {
        await analyseAndStore(feedbackId, { client });
      } catch (e) {
        console.error(`Re-analysis failed for ${feedbackId}`, e);
      }
    });
    refreshAll();
    return null;
  });
}

/** Saves the rows as new reports if the budget covers analysing them all; the import screen then has each analysed. */
export async function importCsvAction(
  csvText: string,
  sourceName: string,
): Promise<Result<{ batchId: string; feedbackIds: string[]; preview: ImportPreview }>> {
  return attempt(async () => {
    if (csvText.length > 500_000) throw new Error("The file is too large (max 500 KB).");
    // Every row will be analysed: check there is budget for all of them before importing anything.
    const rows = Math.max(0, parseCsv(csvText).length - 1);
    await assertBudget(await visitor(), rows * ANALYSIS_ESTIMATE_USD);
    const r = await importCsv(csvText, sourceName);
    refreshAll();
    return r;
  });
}

/** Marks an import finished and says what its rows became, from the saved suggestions (no AI call). */
export async function finishBatchAction(batchId: string): Promise<Result<BatchSummary | null>> {
  return attempt(async () => {
    must(await db().from("batches").update({ status: "done" }).eq("id", batchId).select("id"), "finish batch");
    refreshAll();
    return getBatchSummary(batchId);
  });
}

/** The developer picks a ticket up (see src/lib/ticket-work.ts). */
export async function pickUpAction(ticketKey: string): Promise<Result<null>> {
  return attempt(async () => {
    await pickUp(ticketKey);
    refreshAll();
    return null;
  });
}

/** The developer marks a ticket fixed; the testers who reported it are asked to retest. */
export async function markFixedAction(ticketKey: string, note: string): Promise<Result<{ retesters: number }>> {
  return attempt(async () => {
    const r = await markFixed(ticketKey, note);
    refreshAll();
    return r;
  });
}

/** The developer puts a fixed ticket back in progress; their note is kept on the ticket's history (ticket_events). */
export async function reopenAction(ticketKey: string, note: string): Promise<Result<null>> {
  return attempt(async () => {
    await reopen(ticketKey, note);
    refreshAll();
    return null;
  });
}

/** A tester's retest result for a fixed ticket, recorded against their report. */
export async function retestAction(feedbackId: string, works: boolean, note: string): Promise<Result<{ ticketKey: string }>> {
  return attempt(async () => {
    const r = await recordRetest(feedbackId, works, note);
    refreshAll();
    return r;
  });
}
