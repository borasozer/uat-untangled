import sample from "../../data/sample/medinfo-cycle3.json";
import seedAnalyses from "../../data/sample/seed-analyses.json";
import { calibrationInfo, holdoutInfo } from "./ai/calibration";
import type { Analysis } from "./ai/schema";
import { env } from "./env";
import { nextTicketKey } from "./ticket-key";
import type { ArchitectureFacts } from "./architecture";

/** The report the "How it's built" window follows: a new bug that two more reports describe, approved in the video. */
export const JOURNEY_REF = "FB-021";

/** Below this the AI's figure is shown amber (Confidence and ConfidenceBar in badges.tsx use the same 85%). */
const DOUBTFUL_BELOW = 0.85;

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
  // The window tells the story of a new bug ticket; if the saved suggestion stops being one, fail here (npm test and the
  // build catch it) rather than tell a wrong story.
  const draft = saved.suggestion.draft_ticket;
  if (saved.suggestion.suggested_action !== "create_ticket" || !draft) {
    throw new Error(`${JOURNEY_REF}'s saved suggestion is no longer a new bug ticket.`);
  }
  const total = (bins: { n: number; correct: number }[]) =>
    bins.reduce((sum, b) => ({ n: sum.n + b.n, correct: sum.correct + b.correct }), { n: 0, correct: 0 });
  const { bins } = calibrationInfo();
  const measured = total(bins);
  // Split where Review turns the figure amber (badges.tsx); the measured ranges meet at 85%, so none is cut in two.
  const sure = total(bins.filter((b) => b.min >= DOUBTFUL_BELOW));
  const doubtful = total(bins.filter((b) => b.max <= DOUBTFUL_BELOW));
  const holdout = holdoutInfo();
  const tickets = new Set(sample.tickets.map((t) => t.key));

  return {
    model: env.aiModel,
    samples: env.aiSamples,
    budgets: { dayUsd: env.aiDailyBudgetUsd, totalUsd: env.aiTotalBudgetUsd, visitorHourUsd: env.aiClientHourlyUsd },
    trust: { measured, sure, doubtful, holdout: { n: holdout.n, correct: holdout.correct } },
    journey: {
      ref: report.ref,
      step: report.step ?? "",
      submittedAt: report.at,
      text: report.text,
      result: report.result === "pass" || report.result === "fail" ? report.result : null,
      runs: saved.samples.map((s) => ({ action: s.suggested_action, self: s.confidence_self })),
      // As Review's Why flagged: the first other candidate that is a ticket (a candidate can also be a waiting report).
      nearMiss: saved.suggestion.other_candidates.map((c) => c.target).find((t) => tickets.has(t)) ?? null,
      followers: Object.entries(analyses)
        .filter(([ref, a]) => ref !== JOURNEY_REF && a.suggestion.match.target === JOURNEY_REF)
        .map(([ref]) => ref)
        .sort(),
      agreeing: saved.confidence_detail.agreeing,
      confidence: saved.confidence,
      latencyMs: saved.latency_ms,
      costUsd: saved.usage.cost_usd,
      draft: { title: draft.title, severity: draft.severity, steps: draft.steps_to_reproduce.length },
      ticketKey: nextTicketKey(sample.tickets as { key: string; kind: "bug" | "idea" }[], "bug"),
      reply: saved.suggestion.tester_reply,
    },
  };
}
