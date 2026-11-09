import table from "../../../data/calibration.json";
import holdout from "../../../data/holdout.json";

/**
 * How far to trust the AI, from two files the evaluation script writes (scripts/eval.ts): data/calibration.json, how
 * often suggestions in each confidence range were right on the 57 labelled sample reports, which were also used to tune
 * the prompt (npm run eval), and data/holdout.json, how many held-out reports it got right (npm run eval:holdout). Both
 * are bundled when the app is built, so new figures need a rebuild; nothing here measures. Read by Review's (i),
 * Insights, the Overview page, "How it's built", and analyse.ts.
 */

export type CalibrationBin = { min: number; max: number; n: number; correct: number };

/** The confidence ranges as fractions of 1, as the last npm run eval wrote them; empty if the file has none. */
const bins = (table.bins ?? []) as CalibrationBin[];

/** How often suggestions in this confidence range were right on the labelled sample reports. */
export function calibrate(raw: number): { calibrated: number | null; note: string | null; bin: CalibrationBin | null } {
  const bin = bins.find((b) => raw >= b.min && (raw < b.max || (b.max >= 1 && raw <= 1))) ?? null;
  // Fewer than five labelled cases is too few to quote a rate.
  if (!bin || bin.n < 5) return { calibrated: null, note: null, bin };
  return {
    bin,
    calibrated: bin.correct / bin.n,
    // The sample set was also used to tune the prompt, so the note says so.
    note: `On our ${table.dataset} (also used to tune the AI), suggestions at ${Math.round(bin.min * 100)}–${Math.round(
      bin.max * 100,
    )}% were right ${bin.correct} of ${bin.n} times.`,
  };
}

/** The whole measured table, for the pages that show it: the dataset's name, when it was measured, every range. */
export function calibrationInfo() {
  return { dataset: table.dataset as string, measuredAt: table.measured_at as string | null, bins };
}

/**
 * A smaller check on reports written and labelled by a separate AI agent that never saw the triage prompt or the sample
 * reports, and never used for tuning (scripts/eval.ts, npm run eval:holdout). Small, so it is quoted as a count, never
 * as a rate.
 */
export function holdoutInfo() {
  return { n: holdout.n, correct: holdout.correct, measuredAt: holdout.measured_at, promptVersion: holdout.prompt_version };
}
