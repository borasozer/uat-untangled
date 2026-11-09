import { z } from "zod";

/**
 * What one AI run must return for one report, as a Zod schema: claude.ts sends it as the structured output format and
 * checks the answer against it. The `.describe()` texts go to the model with the schema and work as instructions, so
 * changing one changes the prompt. Saved analyses (the `analyses` table, data/sample/seed-analyses.json) have this shape,
 * and Review's nine buckets are worked out from it (bucketOf in src/lib/labels.ts).
 */

export const CATEGORIES = ["bug", "known_issue", "idea", "question", "not_a_bug", "praise"] as const;
/** What a suggestion does with the report: the same six choices the UAT manager has in Review (decide.ts). */
export const ACTIONS = [
  "create_ticket",
  "link_to_ticket",
  "add_to_ideas",
  "ask_tester",
  "answer",
  "acknowledge",
] as const;
/** How the report stands to its match: same problem, another symptom of it, related (a different defect), or none. */
export const MATCH_RELATIONS = ["exact_duplicate", "different_aspect", "related", "none"] as const;
export const SEVERITIES = ["critical", "high", "medium", "low"] as const;
/** Is there enough to act on? Insufficient caps the confidence at 50%, unless the suggestion is to ask the tester. */
export const EVIDENCE = ["complete", "partial", "insufficient"] as const;

export type Category = (typeof CATEGORIES)[number];
export type Action = (typeof ACTIONS)[number];
export type MatchRelation = (typeof MATCH_RELATIONS)[number];

/** What the model returns for one feedback item. One object per independent run. */
export const AnalysisSchema = z.object({
  category: z.enum(CATEGORIES),
  evidence: z.object({
    quality: z.enum(EVIDENCE),
    known: z
      .array(z.string())
      .describe("Short plain phrases for what we already know, e.g. 'which step', 'what happened', 'enquiry number'."),
    missing: z
      .array(z.string())
      .describe("Short plain phrases for what a developer would still need. Empty if nothing important is missing."),
  }),
  match: z.object({
    target: z
      .string()
      .nullable()
      .describe("Key of the best matching ticket or idea (e.g. MIA-101, IDEA-01), or ref of a pending report (e.g. FB-021). Null if nothing matches."),
    relation: z.enum(MATCH_RELATIONS),
    shared_signals: z
      .array(z.string())
      .describe("Short quotes or facts that the feedback and the target have in common."),
    differences: z.array(z.string()).describe("What differs between the feedback and the target, if anything."),
  }),
  other_candidates: z
    .array(
      z.object({
        target: z.string(),
        relation: z.enum(MATCH_RELATIONS),
        why: z.string(),
      }),
    )
    .describe("Up to 2 other tickets that a person might consider, with one-line reasons."),
  suggested_action: z.enum(ACTIONS),
  rule_id: z.string().nullable().describe("ID of the app rule that explains by-design behaviour, if any."),
  draft_ticket: z
    .object({
      title: z.string(),
      summary: z.string(),
      steps_to_reproduce: z.array(z.string()),
      expected: z.string(),
      actual: z.string(),
      severity: z.enum(SEVERITIES).nullable(),
    })
    .nullable()
    .describe("Required when suggested_action is create_ticket or add_to_ideas (severity null for ideas). Null otherwise."),
  follow_up_question: z
    .string()
    .nullable()
    .describe("One short, specific, kind question for the tester. Required when suggested_action is ask_tester."),
  tester_reply: z.string().describe("Message the tester will see if a person approves this suggestion."),
  explanation: z.string().describe("One or two plain sentences for the UAT manager: why this suggestion."),
  confidence_self: z
    .number()
    .describe("Your honest probability, 0-100, that the UAT manager will agree with suggested_action and match.target."),
});

/** One run's answer: also the shape of analyses.suggestion and of each entry in analyses.samples. */
export type Analysis = z.infer<typeof AnalysisSchema>;

/** Stored with each analysis row. */
export type ConfidenceDetail = {
  samples: number;
  agreeing: number;
  agreement: number;
  self_reported: number;
  raw: number;
  calibrated: number | null;
  calibration_note: string | null;
  evidence: Analysis["evidence"]["quality"];
  alternatives: { key: string; count: number }[];
};

/**
 * The key that names a decision: the action, and for a link the target. Two runs, or the AI and the manager, agree when
 * their keys match. Used to count agreeing runs (analyse.ts), record an overrule (decide.ts) and score the evaluation
 * (scripts/eval.ts).
 */
export function decisionKey(a: Pick<Analysis, "suggested_action" | "match">): string {
  const needsTarget = a.suggested_action === "link_to_ticket";
  return needsTarget ? `${a.suggested_action}:${a.match.target ?? "?"}` : a.suggested_action;
}
