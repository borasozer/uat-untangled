/**
 * Settings from the environment: .env.local locally, the project's environment variables on Vercel. Server only: none
 * is a NEXT_PUBLIC_ variable, so none reaches the browser. Each is read when it is used, so a missing Supabase setting
 * fails where it is first needed, naming the variable. The AI settings have defaults: the model, the three spend limits
 * (the live demo raises the daily and per-visitor ones to $20 and $10) and the number of runs per report.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable ${name}. See .env.example.`);
  }
  return value;
}

export const env = {
  get supabaseUrl() {
    return required("SUPABASE_URL");
  },
  get supabaseSecretKey() {
    return required("SUPABASE_SECRET_KEY");
  },
  get aiModel() {
    return process.env.AI_MODEL || "claude-opus-5-5";
  },
  /** AI spend limits for the public demo, in US dollars (see src/lib/ai/budget.ts). */
  get aiDailyBudgetUsd() {
    return positive("AI_DAILY_BUDGET_USD", 10);
  },
  get aiTotalBudgetUsd() {
    return positive("AI_TOTAL_BUDGET_USD", 60);
  },
  get aiClientHourlyUsd() {
    return positive("AI_CLIENT_HOURLY_USD", 6);
  },
  get aiSamples() {
    const n = Number(process.env.AI_SAMPLES || 3);
    return Number.isInteger(n) && n >= 1 && n <= 5 ? n : 3;
  },
};

/** The variable as a positive number, or the fallback when it is unset, not a number, zero or negative. */
function positive(name: string, fallback: number): number {
  const n = Number(process.env[name] || fallback);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
