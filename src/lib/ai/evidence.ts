import { z } from "zod";
import { structuredCall } from "./claude";
import { estimateCostUsd } from "./pricing";
import type { TriageContext } from "./context";
import { buildAppContext } from "./prompt";

/**
 * The quick check on the report form: when the tester presses Send report, before anything is saved, one short Claude
 * call (low effort, no retry, 12 seconds at most) judges whether there is enough here to act on. If not, it writes one
 * question for the tester; when no test step was picked, it also guesses one for the tester to confirm or turn down. It
 * sees the app's rules and test steps, not the tickets. Nothing here writes: the question and the step are saved with
 * the report only if the tester answers or confirms (submitFeedbackAction in src/app/actions.ts).
 */

export const EvidenceCheckSchema = z.object({
  quality: z.enum(["complete", "partial", "insufficient"]),
  question: z
    .string()
    .nullable()
    .describe("One short, kind, specific question for the tester, only if quality is insufficient. Otherwise null."),
  step_guess: z
    .string()
    .nullable()
    .describe(
      "Only when no test step is given: the id of the test step the report most likely describes (for example TS-04.3), taken from the test scripts above. Null when a step is given, the report is not about a step, or no step clearly fits.",
    ),
});

/**
 * What the report form gets back; checkEvidence keeps step_guess only if it is a real step and the tester gave none.
 */
export type EvidenceCheck = z.infer<typeof EvidenceCheckSchema>;

/**
 * The guessed step, if it is a real step and the tester gave none. The tester confirms it before it is saved, so an
 * unconfirmed guess never reaches the manager as a fact.
 */
export function usableStepGuess(guess: string | null, stepId: string | null, steps: { id: string }[]): string | null {
  if (stepId || !guess) return null;
  return steps.some((s) => s.id === guess) ? guess : null;
}

/** How long the tester waits for the check before the report is sent without it. */
const EVIDENCE_TIMEOUT_MS = 12_000;

/**
 * A quick check while the tester is still on the form: is there enough here for someone to act on?
 * It never blocks submission. The tester can always send the report as it is.
 */
export async function checkEvidence(
  ctx: TriageContext,
  input: { stepId: string | null; result: "pass" | "fail" | null; text: string; testerName: string },
): Promise<{ check: EvidenceCheck; costUsd: number | null }> {
  const step = ctx.steps.find((s) => s.id === input.stepId);
  const { value, model, usage } = await structuredCall({
    schema: EvidenceCheckSchema,
    stableSystem: buildAppContext(ctx),
    volatileSystem:
      "## Task\nA tester is about to submit the report below. Judge only the evidence quality (see rule 2). If it is insufficient, write one question that would make it actionable: refer to the step by what the tester did, never by its id (testers do not know ids such as TS-04.3), offer concrete options where useful, keep it under 25 words, plain and friendly, and never imply they did something wrong. Do not start with thanks or the tester's name. If the report is a suggestion, a question or praise, quality is complete. If no test step is given, also name the test step the report most likely describes, or null if none clearly fits. The tester is asked separately whether that step is right, so the question must not ask about the step you name again: ask about what happened.",
    user: [
      `Tester: ${input.testerName}`,
      step ? `Test step: ${step.id}: ${step.instruction} Expected: ${step.expected}` : "Test step: not given",
      `Marked: ${input.result ?? "not given"}`,
      `Report: "${input.text}"`,
    ].join("\n"),
    effort: "low",
    maxTokens: 2000,
    // The tester is waiting on the Send button: if the check is slow, the report goes as it is.
    timeoutMs: EVIDENCE_TIMEOUT_MS,
    maxRetries: 0,
  });
  return {
    check: { ...value, step_guess: usableStepGuess(value.step_guess, input.stepId, ctx.steps) },
    costUsd: estimateCostUsd(model, {
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      cache_read_input_tokens: usage.cache_read_input_tokens ?? 0,
      cache_creation_input_tokens: usage.cache_creation_input_tokens ?? 0,
    }),
  };
}
