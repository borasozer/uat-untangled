import { createHash } from "node:crypto";
import { db, must } from "../db";
import { env } from "../env";

/**
 * Spend limits for the public demo. Every AI call the web app makes is written to the ai_usage ledger
 * with its cost; before a call, the ledger is checked against three budgets: the last 24 hours, all
 * time, and this visitor's last hour. A bug that loops, or someone scripting the site, stops at the
 * budget instead of running up a bill. Local scripts (evaluation, batch analysis) are not metered.
 */

export type AiKind = "analysis" | "evidence_check";

/** Who is calling: a short hash of the visitor's IP address (the address itself is never stored). */
export function clientId(headers: Headers): string {
  const ip = headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip") || "local";
  return createHash("sha256").update(`untangle:${ip}`).digest("hex").slice(0, 16);
}

/** Cost recorded when a call fails and its real usage is unknown. Deliberately on the high side. */
export const FAILED_CALL_ESTIMATE_USD: Record<AiKind, number> = { analysis: 0.1, evidence_check: 0.02 };

/**
 * Typical cost of one analysis (three independent reviews): the budget must have this much room before each analysis,
 * and this much per row before an import.
 */
export const ANALYSIS_ESTIMATE_USD = 0.08;

export class BudgetError extends Error {}

/** Throws a BudgetError if spending `estimateUsd` more would break any of the three budgets. */
export async function assertBudget(client: string, estimateUsd = 0): Promise<void> {
  const [spend] = must(await db().rpc("ai_spend", { p_client: client }), "check AI budget") as {
    day_usd: number;
    total_usd: number;
    client_hour_usd: number;
  }[];
  const day = Number(spend?.day_usd ?? 0);
  const total = Number(spend?.total_usd ?? 0);
  const hour = Number(spend?.client_hour_usd ?? 0);

  if (total + estimateUsd > env.aiTotalBudgetUsd) {
    throw new BudgetError("The demo's AI budget is used up. Saved suggestions still work.");
  }
  if (day + estimateUsd > env.aiDailyBudgetUsd) {
    throw new BudgetError("The demo's daily AI budget is used up. Saved suggestions still work; please try again tomorrow.");
  }
  if (hour + estimateUsd > env.aiClientHourlyUsd) {
    throw new BudgetError("You have used this demo's AI a lot in the last hour. Please try again a little later.");
  }
}

/**
 * Adds one AI call to the ai_usage ledger; with no cost known (a failed call, a model not in PRICES) it records the
 * high estimate.
 */
export async function recordUsage(kind: AiKind, client: string, costUsd: number | null, ok = true): Promise<void> {
  const cost = costUsd ?? FAILED_CALL_ESTIMATE_USD[kind];
  must(
    await db()
      .from("ai_usage")
      .insert({ kind, client, cost_usd: Math.round(cost * 10_000) / 10_000, ok })
      .select("id"),
    "record AI usage",
  );
}
