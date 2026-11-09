// Measures the AI against the labelled sample data and writes the calibration table.
// Each report is judged on its own against the seed tickets (no database writes). A report that
// created a seed ticket is judged without that ticket, so the AI has to propose it from scratch.
// Usage: npm run eval            (spends API credit: about $0.06 per report with 3 runs, about $3.30 for all 57)
//        LIMIT=10 npm run eval   (first 10 reports only)
//        npm run eval:holdout    (the 15 held-out reports, written and labelled by a separate AI agent that never saw the
//                                 AI's instructions or the sample reports; about $1.10; results go to data/holdout.json,
//                                 data/calibration.json is left alone)
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import sample from "../data/sample/medinfo-cycle3.json";
import truthImport from "../data/sample/uat-cycle3-week2.truth.json";
import { runAnalysis, sumUsage } from "../src/lib/ai/analyse";
import type { TriageContext } from "../src/lib/ai/context";
import { acceptableDecisions, CLUSTER_TICKET } from "../src/lib/ai/expected";
import { estimateCostUsd } from "../src/lib/ai/pricing";
import { PROMPT_VERSION } from "../src/lib/ai/prompt";
import { decisionKey, type Analysis } from "../src/lib/ai/schema";
import { mapColumns, normaliseResult, normaliseStepId, parseCsv } from "../src/lib/csv";
import { env } from "../src/lib/env";
import type { Feedback, Person, Step, Ticket, Truth } from "../src/lib/types";

const CONCURRENCY = Number(process.env.CONCURRENCY || 4);
const LIMIT = Number(process.env.LIMIT || 0);
const HOLDOUT = process.env.DATASET === "holdout";
const HOLDOUT_FILE = "data/sample/holdout-cycle3.json";
const BINS = [
  [0, 0.6],
  [0.6, 0.85],
  [0.85, 0.95],
  [0.95, 1.0001],
] as const;

type Item = { feedback: Feedback; truth: Truth };

function buildItems(people: Person[]): Item[] {
  const base = {
    cycle_id: sample.cycle.id,
    batch_id: null,
    status: "new" as const,
    ticket_id: null,
    relation: null,
    follow_up_question: null,
    follow_up_answer: null,
    tester_message: null,
  };
  // Deliberately ambiguous demo examples are not part of the measured set.
  const fromSeed: Item[] = sample.feedback.filter((f) => !("demo_only" in f && f.demo_only)).map((f) => ({
    feedback: {
      ...base,
      id: f.ref,
      ref: f.ref,
      tester_id: f.tester,
      step_id: f.step,
      text: f.text,
      reported_result: f.result as "pass" | "fail",
      source: "tester_app",
      submitted_at: f.at,
      truth: f.truth as Truth,
    },
    truth: f.truth as Truth,
  }));

  const [header, ...rows] = parseCsv(readFileSync("public/samples/uat-cycle3-week2.csv", "utf8"));
  const stepIds = sample.scripts.flatMap((s) => s.steps.map((st) => `${s.id}.${st.step_no}`));
  const map = mapColumns(header);
  const truths = truthImport as unknown as Record<string, Truth>;
  const fromImport: Item[] = rows.map((cells) => {
    const ref = cells[map.ref!];
    const tester = people.find((p) => p.name === cells[map.tester!]);
    return {
      feedback: {
        ...base,
        id: ref,
        ref,
        tester_id: tester?.id ?? null,
        step_id: normaliseStepId(cells[map.step!], stepIds),
        text: cells[map.text!],
        reported_result: normaliseResult(cells[map.result!]),
        source: "import",
        submitted_at: `${cells[map.date!]}T12:00:00Z`,
        truth: truths[ref],
      },
      truth: truths[ref],
    };
  });
  return [...fromSeed, ...fromImport];
}

/**
 * The held-out reports: written and labelled by a separate AI agent that never saw the AI's instructions or the sample
 * reports.
 */
function buildHoldout(): Item[] {
  const rows = (JSON.parse(readFileSync(HOLDOUT_FILE, "utf8")) as { reports: SampleRow[] }).reports;
  return rows.map((f) => ({
    feedback: {
      cycle_id: sample.cycle.id,
      batch_id: null,
      status: "new",
      ticket_id: null,
      relation: null,
      follow_up_question: null,
      follow_up_answer: null,
      tester_message: null,
      id: f.ref,
      ref: f.ref,
      tester_id: f.tester,
      step_id: f.step,
      text: f.text,
      reported_result: f.result,
      source: "tester_app",
      submitted_at: f.at,
      truth: f.truth,
    },
    truth: f.truth,
  }));
}

type SampleRow = { ref: string; tester: string; step: string | null; result: "pass" | "fail" | null; at: string; text: string; truth: Truth };

/** The seed ticket a report created, if any. The eval hides it, so the AI has to propose it again. */
function ownTicket(ref: string) {
  return sample.tickets.find((t) => "source_ref" in t && t.source_ref === ref);
}

/** The seed's tickets and decided reports, as the AI would see them, minus the report under test. */
function contextFor(item: Item, people: Person[]): TriageContext {
  const steps: Step[] = sample.scripts.flatMap((s) =>
    s.steps.map((st) => ({ id: `${s.id}.${st.step_no}`, script_id: s.id, ...st })),
  );
  const hidden = ownTicket(item.feedback.ref)?.key;
  const tickets: Ticket[] = sample.tickets.filter((t) => t.key !== hidden).map((t) => ({
    id: t.key,
    key: t.key,
    cycle_id: sample.cycle.id,
    kind: t.kind as Ticket["kind"],
    origin: t.origin as Ticket["origin"],
    title: t.title,
    summary: t.summary,
    step_id: t.step_id,
    steps_to_reproduce: ("steps_to_reproduce" in t && t.steps_to_reproduce) || [],
    expected: ("expected" in t && t.expected) || null,
    actual: ("actual" in t && t.actual) || null,
    severity: ("severity" in t ? t.severity : null) as Ticket["severity"],
    status: t.status as Ticket["status"],
    status_note: "status_note" in t ? (t.status_note as string) : null,
    // Ownership is not part of what the AI reads.
    assignee_id: null,
    created_by: null,
    created_at: "2026-10-26T09:00:00Z",
  }));
  const examplesByTicket = new Map<string, string[]>();
  for (const f of sample.feedback) {
    const key = (f as { decided?: { ticket?: string } }).decided?.ticket;
    if (!key || f.ref === item.feedback.ref) continue;
    const list = examplesByTicket.get(key) ?? [];
    if (list.length < 3) list.push(f.text);
    examplesByTicket.set(key, list);
  }
  return {
    cycle: sample.cycle,
    rules: sample.app_rules.map((r) => ({ ...r, cycle_id: sample.cycle.id })),
    scripts: sample.scripts.map((s) => ({ id: s.id, cycle_id: sample.cycle.id, title: s.title, area: s.area, sort: s.sort })),
    steps,
    people,
    tickets,
    examplesByTicket,
    pending: [item.feedback],
  };
}

async function main() {
  const people = sample.people as Person[];
  let items = HOLDOUT ? buildHoldout() : buildItems(people);
  if (LIMIT) items = items.slice(0, LIMIT);
  console.log(`Evaluating ${items.length} ${HOLDOUT ? "held-out " : ""}reports, ${env.aiSamples} runs each, model ${env.aiModel}...`);

  type Result = {
    ref: string;
    expected: string[];
    got: string;
    correct: boolean;
    categoryCorrect: boolean;
    evidenceCorrect: boolean;
    confidence: number;
    agreeing: number;
    suggestion: Analysis;
    costUsd: number;
    latencyMs: number;
  };
  const results: Result[] = [];
  const failures: string[] = [];
  let next = 0;
  const started = Date.now();

  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < items.length) {
        const item = items[next++];
        try {
          const { result, runs } = await runAnalysis(contextFor(item, people), item.feedback);
          const got = decisionKey(result.suggestion);
          const own = ownTicket(item.feedback.ref);
          const tickets = own
            ? Object.fromEntries(Object.entries(CLUSTER_TICKET).filter(([, key]) => key !== own.key))
            : CLUSTER_TICKET;
          const expected = acceptableDecisions(item.truth, tickets, {}, item.feedback.ref);
          const truthCategory = item.truth.category;
          results.push({
            ref: item.feedback.ref,
            expected,
            got,
            correct: expected.includes(got),
            categoryCorrect: result.suggestion.category === truthCategory,
            evidenceCorrect: result.suggestion.evidence.quality === item.truth.evidence,
            confidence: result.confidence,
            agreeing: result.detail.agreeing,
            suggestion: result.suggestion,
            costUsd: estimateCostUsd(runs[0].model, sumUsage(runs)) ?? 0,
            latencyMs: Math.max(...runs.map((r) => r.latencyMs)),
          });
          process.stdout.write(expected.includes(got) ? "." : "x");
        } catch (e) {
          failures.push(`${item.feedback.ref}: ${e instanceof Error ? e.message : e}`);
          process.stdout.write("!");
        }
      }
    }),
  );
  results.sort((a, b) => a.ref.localeCompare(b.ref, "en", { numeric: true }));

  const n = results.length;
  const pct = (k: number, d: number) => (d ? `${Math.round((k / d) * 100)}%` : "-");
  const correct = results.filter((r) => r.correct).length;
  const cost = results.reduce((s, r) => s + r.costUsd, 0);
  console.log(`\n\nDecision correct:  ${correct}/${n} (${pct(correct, n)})`);
  console.log(`Category correct:  ${results.filter((r) => r.categoryCorrect).length}/${n}`);
  console.log(`Evidence correct:  ${results.filter((r) => r.evidenceCorrect).length}/${n}`);
  console.log(`Cost: $${cost.toFixed(2)} ($${(cost / Math.max(1, n)).toFixed(3)} per report), wall time ${((Date.now() - started) / 1000).toFixed(0)}s`);

  const bins = BINS.map(([min, max]) => {
    const inBin = results.filter((r) => r.confidence >= min && r.confidence < max);
    return { min, max: Math.min(1, max), n: inBin.length, correct: inBin.filter((r) => r.correct).length };
  });
  console.log("\nConfidence   reports  right");
  for (const b of bins) {
    console.log(`${Math.round(b.min * 100)}-${Math.round(b.max * 100)}%`.padEnd(13) + `${b.n}`.padStart(7) + `  ${pct(b.correct, b.n)}`);
  }

  const wrong = results.filter((r) => !r.correct);
  if (wrong.length) {
    console.log("\nMisses:");
    for (const r of wrong) {
      console.log(`  ${r.ref}: got ${r.got} (${Math.round(r.confidence * 100)}%), expected ${r.expected.join(" or ")}`);
      console.log(`      ${r.suggestion.explanation}`);
    }
  }
  if (failures.length) console.log(`\nFailures:\n  ${failures.join("\n  ")}`);

  const date = new Date().toISOString().slice(0, 10);
  mkdirSync("data/eval", { recursive: true });
  writeFileSync(
    `data/eval/results-${date}-${PROMPT_VERSION}${HOLDOUT ? "-holdout" : ""}.json`,
    JSON.stringify({ model: env.aiModel, prompt_version: PROMPT_VERSION, samples: env.aiSamples, measured_at: new Date().toISOString(), correct, n, cost_usd: cost, bins, results }, null, 2) + "\n",
  );
  if (HOLDOUT && !LIMIT) {
    writeFileSync(
      "data/holdout.json",
      JSON.stringify(
        {
          _about:
            "Written by scripts/eval.ts (npm run eval:holdout). Accuracy on reports written and labelled by a separate AI agent that never saw the AI's instructions or the sample reports; not used to tune anything.",
          dataset: `${n} held-out reports`,
          measured_at: new Date().toISOString(),
          model: env.aiModel,
          prompt_version: PROMPT_VERSION,
          correct,
          n,
          bins,
          misses: wrong.map((r) => ({ ref: r.ref, got: r.got, expected: r.expected, confidence: r.confidence })),
        },
        null,
        2,
      ) + "\n",
    );
    console.log("\nWrote data/holdout.json");
  }
  if (!HOLDOUT && !LIMIT && n >= 40) {
    writeFileSync(
      "data/calibration.json",
      JSON.stringify(
        {
          _about: "Written by scripts/eval.ts. Accuracy of AI suggestions per confidence range on the labelled sample data.",
          dataset: `${n} labelled sample reports`,
          measured_at: new Date().toISOString(),
          model: env.aiModel,
          prompt_version: PROMPT_VERSION,
          bins,
        },
        null,
        2,
      ) + "\n",
    );
    console.log("\nWrote data/calibration.json");
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
