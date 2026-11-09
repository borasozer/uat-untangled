import sample from "../../data/sample/medinfo-cycle3.json";
import seedAnalyses from "../../data/sample/seed-analyses.json";
import { calibrationInfo, holdoutInfo } from "./ai/calibration";
import type { Analysis } from "./ai/schema";
import { env } from "./env";
import type { ArchitectureFacts } from "./architecture";

/** The report the "How it's built" window follows: a new bug that two more reports describe, approved in the video. */
export const JOURNEY_REF = "FB-021";

/** The fields used here from one saved analysis in seed-analyses.json; the JSON is cast to this type, not checked. */
type SavedAnalysis = {
  suggestion: Analysis;
  samples: Analysis[];
  confidence: number;
  confidence_detail: { agreeing: number };
  latency_ms: number;
  usage: { cost_usd: number | null };
};

/** Server only: reads the spend limits and the sample data, so the window's numbers match the code. */
export function architectureFacts(): ArchitectureFacts {
  const report = sample.feedback.find((f) => f.ref === JOURNEY_REF);
  const analyses = seedAnalyses.analyses as unknown as Record<string, SavedAnalysis>;
  const saved = analyses[JOURNEY_REF];
  if (!report || !saved) throw new Error(`The sample data no longer has ${JOURNEY_REF} and its saved analysis.`);
  const measured = calibrationInfo().bins.reduce(
    (sum, b) => ({ n: sum.n + b.n, correct: sum.correct + b.correct }),
    { n: 0, correct: 0 },
  );
  const holdout = holdoutInfo();
  const person = (pick: (p: (typeof sample.people)[number]) => boolean) => sample.people.find(pick)?.name ?? "";

  return {
    model: env.aiModel,
    samples: env.aiSamples,
    budgets: { dayUsd: env.aiDailyBudgetUsd, totalUsd: env.aiTotalBudgetUsd, visitorHourUsd: env.aiClientHourlyUsd },
    trust: { measured, holdout: { n: holdout.n, correct: holdout.correct } },
    journey: {
      ref: report.ref,
      step: report.step ?? "",
      submittedAt: report.at,
      text: report.text,
      result: report.result === "pass" || report.result === "fail" ? report.result : null,
      tester: person((p) => p.id === report.tester),
      manager: person((p) => p.role === "manager"),
      developer: person((p) => p.role === "developer"),
      runs: saved.samples.map((s) => ({ action: s.suggested_action, self: s.confidence_self })),
      action: saved.suggestion.suggested_action,
      nearMiss: saved.suggestion.other_candidates[0]?.target ?? null,
      why: saved.suggestion.explanation,
      followers: Object.entries(analyses)
        .filter(([ref, a]) => ref !== JOURNEY_REF && a.suggestion.match.target === JOURNEY_REF)
        .map(([ref]) => ref)
        .sort(),
      agreeing: saved.confidence_detail.agreeing,
      confidence: saved.confidence,
      latencyMs: saved.latency_ms,
      costUsd: saved.usage.cost_usd,
      draft: saved.suggestion.draft_ticket
        ? { title: saved.suggestion.draft_ticket.title, severity: saved.suggestion.draft_ticket.severity }
        : null,
      reply: saved.suggestion.tester_reply,
    },
  };
}
