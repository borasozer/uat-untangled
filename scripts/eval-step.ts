// Measures the test-step guess of the tester's quick check: each labelled report is checked as if the tester had not
// picked a step, and the guess is compared with the step the report was written for. Reports written without a step are
// checked too: for them the right answer is no suggestion. The check's question, if it asks one, is printed, to see
// whether it leans on a guessed step the tester may turn down. No database reads or writes.
// Usage: npm run eval:step                        (spends API credit: about half a cent per report)
//        LIMIT=5 npm run eval:step                (first 5 reports only)
//        REFS=HO-03,HO-05 npm run eval:step       (these reports only)
import sample from "../data/sample/medinfo-cycle3.json";
import holdout from "../data/sample/holdout-cycle3.json";
import type { TriageContext } from "../src/lib/ai/context";
import { checkEvidence } from "../src/lib/ai/evidence";
import { env } from "../src/lib/env";
import type { Person, Step } from "../src/lib/types";

const CONCURRENCY = Number(process.env.CONCURRENCY || 4);
const LIMIT = Number(process.env.LIMIT || 0);
const REFS = (process.env.REFS || "").split(",").map((r) => r.trim()).filter(Boolean);

type Item = { ref: string; tester: string; step: string | null; text: string };

function context(): TriageContext {
  const steps: Step[] = sample.scripts.flatMap((s) =>
    s.steps.map((st) => ({ id: `${s.id}.${st.step_no}`, script_id: s.id, ...st })),
  );
  return {
    cycle: sample.cycle,
    rules: sample.app_rules.map((r) => ({ ...r, cycle_id: sample.cycle.id })),
    scripts: sample.scripts.map((s) => ({ id: s.id, cycle_id: sample.cycle.id, title: s.title, area: s.area, sort: s.sort })),
    steps,
    people: sample.people as Person[],
    // The quick check reads only the app, its rules and its test scripts.
    tickets: [],
    examplesByTicket: new Map(),
    pending: [],
  };
}

async function main() {
  // Deliberately ambiguous demo examples are left out of the reports with a step, as in the main evaluation; their
  // ambiguity is about duplicates, not steps, so the ones without a step are kept.
  const withStep = [...sample.feedback.filter((f) => f.step && !("demo_only" in f && f.demo_only)), ...holdout.reports.filter((f) => f.step)];
  const withoutStep = [...sample.feedback, ...holdout.reports].filter((f) => !f.step);
  let items: Item[] = [...withStep, ...withoutStep].map((f) => ({
    ref: f.ref,
    tester: f.tester,
    step: (f.step as string | null) ?? null,
    text: f.text,
  }));
  if (REFS.length) items = items.filter((i) => REFS.includes(i.ref));
  if (LIMIT) items = items.slice(0, LIMIT);
  const ctx = context();
  console.log(`Checking ${items.length} reports without their step, model ${env.aiModel}...`);

  const rows: { ref: string; step: string | null; guess: string | null; question: string | null; cost: number | null }[] = [];
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const item = items[next++];
      const testerName = ctx.people.find((p) => p.id === item.tester)?.name ?? "there";
      try {
        const { check, costUsd } = await checkEvidence(ctx, { stepId: null, result: null, text: item.text, testerName });
        rows.push({ ref: item.ref, step: item.step, guess: check.step_guess, question: check.question, cost: costUsd });
      } catch (e) {
        console.error(`${item.ref}: ${(e as Error).message}`);
        rows.push({ ref: item.ref, step: item.step, guess: null, question: null, cost: null });
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  rows.sort((a, b) => a.ref.localeCompare(b.ref));
  const script = (id: string) => id.split(".")[0];
  for (const r of rows) {
    const mark = !r.step
      ? r.guess
        ? "SUGGESTED (report has no step)"
        : "right (no suggestion)"
      : r.guess === r.step
        ? "right"
        : !r.guess
          ? "no guess"
          : script(r.guess) === script(r.step)
            ? "same script"
            : "WRONG";
    console.log(`${r.ref.padEnd(6)} ${String(r.step ?? "none").padEnd(8)} ${String(r.guess).padEnd(8)} ${mark}`);
    if (r.question) console.log(`       asks: ${r.question}`);
  }
  const stepped = rows.filter((r) => r.step);
  const right = stepped.filter((r) => r.guess === r.step).length;
  const none = stepped.filter((r) => !r.guess).length;
  const sameScript = stepped.filter((r) => r.guess && r.guess !== r.step && script(r.guess) === script(r.step!)).length;
  const wrong = stepped.length - right - none - sameScript;
  const general = rows.filter((r) => !r.step);
  const quiet = general.filter((r) => !r.guess).length;
  const cost = rows.reduce((s, r) => s + (r.cost ?? 0), 0);
  console.log(
    `\nWith a step: ${right} of ${stepped.length} right · ${sameScript} the right script, another step · ${wrong} wrong · ${none} no guess` +
      `\nWithout a step: ${quiet} of ${general.length} with no suggestion · $${cost.toFixed(2)}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
