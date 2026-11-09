import { db, must } from "../db";
import { env } from "../env";
import type { Feedback } from "../types";
import { ANALYSIS_ESTIMATE_USD, assertBudget, recordUsage } from "./budget";
import { calibrate } from "./calibration";
import { estimateCostUsd, type Usage } from "./pricing";
import { structuredCall, type StructuredResult } from "./claude";
import { loadContext, type TriageContext } from "./context";
import { buildAppContext, buildFeedbackMessage, buildTicketContext, PROMPT_VERSION } from "./prompt";
import { AnalysisSchema, decisionKey, type Analysis, type ConfidenceDetail } from "./schema";

/**
 * The AI's suggestion for one report. The same prompt goes to Claude three times in parallel (AI_SAMPLES can set 1 to 5);
 * the runs are merged into one suggestion with a confidence figure and saved, all runs included, in the `analyses` table,
 * where Review finds it. It only suggests: the report moves to awaiting review, and a person decides it there.
 * Called for a new report, a tester's answer and Review's retry (src/app/actions.ts), for each imported row
 * (src/app/api/analyse/route.ts) and by npm run analyse:pending; npm run eval uses runAnalysis, which writes nothing.
 *
 * The confidence figure (aggregate): runs that chose the same decision (decisionKey: the action, and for a link the
 * target) form a group. The largest group wins, a tie going to the higher average self-estimate, and its most confident
 * run is the suggestion. The figure is half the share of runs in that group plus half their average self-estimate
 * (confidence_self, out of 100). It is capped at 50% when the suggestion would act on a report whose evidence is
 * insufficient; a suggestion to ask the tester is not capped.
 */

export type AggregatedAnalysis = {
  suggestion: Analysis;
  samples: Analysis[];
  confidence: number;
  detail: ConfidenceDetail;
};

/**
 * Turns several independent runs into one suggestion and an honest confidence number.
 * The number blends two signals: how many runs agreed on the same decision, and how sure
 * the agreeing runs said they were. The number itself is not adjusted: how often that range was
 * right on the labelled sample reports is stored beside it (detail.calibrated), when the range
 * has at least five cases (calibration.ts).
 */
export function aggregate(samples: Analysis[]): AggregatedAnalysis {
  const groups = new Map<string, Analysis[]>();
  for (const s of samples) {
    const key = decisionKey(s);
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  const ranked = [...groups.entries()].sort((a, b) => {
    if (b[1].length !== a[1].length) return b[1].length - a[1].length;
    return avgSelf(b[1]) - avgSelf(a[1]);
  });
  const [, winners] = ranked[0];
  const suggestion = [...winners].sort((a, b) => b.confidence_self - a.confidence_self)[0];

  const agreement = winners.length / samples.length;
  const selfReported = clamp01(avgSelf(winners) / 100);
  let raw = 0.5 * agreement + 0.5 * selfReported;
  // A report we cannot act on should never look like a confident ticket.
  if (suggestion.evidence.quality === "insufficient" && suggestion.suggested_action !== "ask_tester") {
    raw = Math.min(raw, 0.5);
  }
  const { calibrated, note } = calibrate(raw);

  return {
    suggestion,
    samples,
    confidence: round2(raw),
    detail: {
      samples: samples.length,
      agreeing: winners.length,
      agreement: round2(agreement),
      self_reported: round2(selfReported),
      raw: round2(raw),
      calibrated: calibrated === null ? null : round2(calibrated),
      calibration_note: note,
      evidence: suggestion.evidence.quality,
      alternatives: ranked.slice(1).map(([key, list]) => ({ key, count: list.length })),
    },
  };
}

/** Runs the independent analyses for one feedback item. Does not write to the database. */
export async function runAnalysis(
  ctx: TriageContext,
  feedback: Feedback,
  samples = env.aiSamples,
): Promise<{ result: AggregatedAnalysis; runs: StructuredResult<Analysis>[] }> {
  const stableSystem = buildAppContext(ctx);
  const volatileSystem = buildTicketContext(ctx, feedback.id);
  const user = buildFeedbackMessage(ctx, feedback);
  const runs = await Promise.all(
    Array.from({ length: samples }, () =>
      structuredCall({ schema: AnalysisSchema, stableSystem, volatileSystem, user }),
    ),
  );
  return { result: aggregate(runs.map((r) => r.value)), runs };
}

/**
 * Analyses one feedback item and stores the suggestion for the manager's review queue.
 * `client` identifies a website visitor for the spend budget; null means a local script (not metered).
 */
export async function analyseAndStore(
  feedbackId: string,
  { ctx, client }: { ctx?: TriageContext; client: string | null },
): Promise<string> {
  if (client) await assertBudget(client, ANALYSIS_ESTIMATE_USD);
  const supabase = db();
  const feedback = must(
    await supabase.from("feedback").select("*").eq("id", feedbackId).single(),
    "load feedback",
  ) as Feedback;
  const loaded = ctx ?? (await loadContext(feedback.cycle_id));
  // Make sure this report appears in the pending list (it may have been re-opened since the context was loaded).
  const context = loaded.pending.some((f) => f.id === feedback.id)
    ? loaded
    : { ...loaded, pending: [...loaded.pending, feedback] };
  let analysis: Awaited<ReturnType<typeof runAnalysis>>;
  try {
    analysis = await runAnalysis(context, feedback);
  } catch (e) {
    if (client) await recordUsage("analysis", client, null, false);
    throw e;
  }
  const { result, runs } = analysis;
  const usage = sumUsage(runs);
  const model = runs[0]?.model ?? env.aiModel;
  const costUsd = estimateCostUsd(model, usage);
  if (client) await recordUsage("analysis", client, costUsd);

  const row = must(
    await supabase
      .from("analyses")
      .insert({
        feedback_id: feedback.id,
        model,
        prompt_version: PROMPT_VERSION,
        suggestion: result.suggestion,
        samples: result.samples,
        confidence: result.confidence,
        confidence_detail: result.detail,
        // The runs are parallel: the slowest one is how long the analysis took.
        latency_ms: Math.max(...runs.map((r) => r.latencyMs)),
        usage: { ...usage, cost_usd: costUsd },
      })
      .select("id")
      .single(),
    "store analysis",
  ) as { id: string };

  if (feedback.status === "new" || feedback.status === "needs_info") {
    must(
      await supabase
        .from("feedback")
        .update({ status: "awaiting_review" })
        .eq("id", feedback.id)
        // Someone may have decided the report while the AI was still working: keep their decision.
        .in("status", ["new", "needs_info"])
        .select("id"),
      "update feedback status",
    );
  }
  return row.id;
}

/** The token counts of several runs added up, a missing cache count as 0: the analysis's cost is worked out from it. */
export function sumUsage(runs: StructuredResult<unknown>[]): Usage {
  return runs.reduce<Usage>(
    (acc, r) => ({
      input_tokens: acc.input_tokens + r.usage.input_tokens,
      output_tokens: acc.output_tokens + r.usage.output_tokens,
      cache_read_input_tokens: acc.cache_read_input_tokens + (r.usage.cache_read_input_tokens ?? 0),
      cache_creation_input_tokens: acc.cache_creation_input_tokens + (r.usage.cache_creation_input_tokens ?? 0),
    }),
    { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  );
}

/** The runs' average confidence_self, on its 0 to 100 scale. */
function avgSelf(list: Analysis[]): number {
  return list.reduce((sum, a) => sum + a.confidence_self, 0) / list.length;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
