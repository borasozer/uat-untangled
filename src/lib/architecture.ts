/**
 * What the "How it's built" window shows. Safe to use in the browser: no server code, no secrets.
 * The numbers in it come from the server (src/lib/architecture-facts.ts), so they follow the code.
 */
import type { Action } from "./ai/schema";

/** The database tables, grouped for people. A test checks this list against the migrations. */
export const TABLE_GROUPS: { name: string; tables: string[] }[] = [
  { name: "Test plan", tables: ["cycles", "scripts", "steps", "app_rules", "people"] },
  { name: "Reports", tables: ["feedback", "batches"] },
  { name: "AI", tables: ["analyses", "ai_usage"] },
  { name: "Decisions", tables: ["decisions"] },
  { name: "Work", tables: ["tickets", "ticket_events"] },
];

export const TABLE_NOTE: Record<string, string> = {
  cycles: "The test round: which app and release, and its dates.",
  scripts: "The test scripts the testers follow.",
  steps: "Each step of a script and what should happen.",
  app_rules: "What is meant to be that way, so it is not called a bug.",
  people: "Testers, the UAT manager and the developer.",
  feedback: "Every report, in the tester's own words.",
  batches: "Spreadsheet imports and how far each got.",
  analyses: "Every AI answer, with all its runs, its cost and time.",
  ai_usage: "One line per AI call, with what it cost.",
  decisions: "Each decision: what the AI suggested, what the person chose.",
  tickets: "Bugs and ideas, including issues known before the round.",
  ticket_events: "What happened next: picked up, fixed, retested, reopened.",
};

/** What the server hands the window: built by architectureFacts() in the root layout, passed via Nav to HowItsBuilt. */
export type ArchitectureFacts = {
  model: string;
  /** Independent AI runs per report. */
  samples: number;
  budgets: { dayUsd: number; totalUsd: number; visitorHourUsd: number };
  /**
   * How often the AI was right: on the labelled samples (also used to tune it), the same samples split at 85% (sure:
   * 85% or more; doubtful: below, where Review shows the figure amber), and on reports never used for tuning.
   */
  trust: {
    measured: { n: number; correct: number };
    sure: { n: number; correct: number };
    doubtful: { n: number; correct: number };
    holdout: { n: number; correct: number };
  };
  /** One sample report, followed from the tester's words to a fix. Steps 1 and 2 are its saved record. */
  journey: {
    ref: string;
    step: string;
    submittedAt: string;
    text: string;
    result: "pass" | "fail" | null;
    /** Each run's outcome and its own estimate (0 to 100) that a person will agree. */
    runs: { action: Action; self: number }[];
    /** The ticket that looked close but was not the same, if the AI named one. */
    nearMiss: string | null;
    /** Waiting reports the AI says describe the same problem: they join this one's ticket. */
    followers: string[];
    agreeing: number;
    /** 0 to 1, as shown on the review screen. */
    confidence: number;
    latencyMs: number;
    costUsd: number | null;
    /** The ticket the AI drafted, with how many steps to reproduce it has. */
    draft: { title: string; severity: string | null; steps: number };
    /** The key the ticket gets if it is the first new bug after the demo starts over (MIA-106), as in the video. */
    ticketKey: string;
    /** The reply the AI drafted; {ticket} is filled in when a person approves. */
    reply: string;
  };
};
