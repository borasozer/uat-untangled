// Analyses every undecided report that has no AI suggestion yet, then prints a report:
// suggestion, confidence, time, cost, and (for sample data) whether it matches the ground truth.
// Usage: npm run analyse:pending      (spends API credit)
import { analyseAndStore } from "../src/lib/ai/analyse";
import { loadContext } from "../src/lib/ai/context";
import { acceptableDecisions, CLUSTER_TICKET } from "../src/lib/ai/expected";
import { decisionKey, type Analysis, type ConfidenceDetail } from "../src/lib/ai/schema";
import { db } from "../src/lib/db";
import type { Feedback } from "../src/lib/types";

const CONCURRENCY = Number(process.env.CONCURRENCY || 3);

async function main() {
  const supabase = db();
  const { data: pending, error } = await supabase.from("feedback").select("*").eq("status", "new").order("ref");
  if (error) throw new Error(error.message);
  const items = pending as Feedback[];
  console.log(`Analysing ${items.length} report(s) with concurrency ${CONCURRENCY}...`);

  const ctx = await loadContext();
  // Seed tickets, plus tickets people have created since (via the truth of their linked reports).
  const ticketByCluster: Record<string, string> = { ...CLUSTER_TICKET };
  const { data: decided } = await supabase.from("feedback").select("truth, ticket_id").not("ticket_id", "is", null);
  for (const row of (decided ?? []) as { truth: { cluster: string | null } | null; ticket_id: string }[]) {
    const key = ctx.tickets.find((t) => t.id === row.ticket_id)?.key;
    if (row.truth?.cluster && key) ticketByCluster[row.truth.cluster] = key;
  }
  const pendingClusters = Object.fromEntries(ctx.pending.map((f) => [f.ref, f.truth?.cluster ?? null]));

  const started = Date.now();
  let next = 0;
  const failures: string[] = [];
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < items.length) {
        const f = items[next++];
        try {
          await analyseAndStore(f.id, { ctx, client: null });
          process.stdout.write(".");
        } catch (e) {
          failures.push(`${f.ref}: ${e instanceof Error ? e.message : e}`);
          process.stdout.write("x");
        }
      }
    }),
  );
  console.log(`\nDone in ${((Date.now() - started) / 1000).toFixed(1)}s.\n`);

  const { data: rows } = await supabase
    .from("analyses")
    .select("feedback_id, suggestion, confidence, confidence_detail, latency_ms, usage, model")
    .in(
      "feedback_id",
      items.map((f) => f.id),
    );
  let correct = 0;
  let labelled = 0;
  let cost = 0;
  for (const f of items) {
    const a = (rows ?? []).find((r) => r.feedback_id === f.id) as
      | {
          suggestion: Analysis;
          confidence: number;
          confidence_detail: ConfidenceDetail;
          latency_ms: number;
          usage: { cost_usd: number | null; input_tokens: number; output_tokens: number; cache_read_input_tokens: number };
        }
      | undefined;
    if (!a) continue;
    const key = decisionKey(a.suggestion);
    let verdict = "";
    if (f.truth) {
      labelled++;
      const ok = acceptableDecisions(f.truth, ticketByCluster, pendingClusters, f.ref);
      const hit = ok.includes(key);
      if (hit) correct++;
      verdict = hit ? "RIGHT" : `WRONG (expected ${ok.join(" or ")})`;
    }
    cost += a.usage.cost_usd ?? 0;
    console.log(
      `${f.ref}  ${key.padEnd(28)} ${String(Math.round(a.confidence * 100)).padStart(3)}%  ` +
        `${a.confidence_detail.agreeing}/${a.confidence_detail.samples} agree  ` +
        `${(a.latency_ms / 1000).toFixed(1)}s  $${(a.usage.cost_usd ?? 0).toFixed(3)}  ` +
        `in=${a.usage.input_tokens} cache=${a.usage.cache_read_input_tokens} out=${a.usage.output_tokens}  ${verdict}`,
    );
    console.log(`        ${a.suggestion.category} | ${a.suggestion.explanation}`);
    if (a.suggestion.follow_up_question) console.log(`        Q: ${a.suggestion.follow_up_question}`);
    console.log(`        Tester: ${a.suggestion.tester_reply}`);
  }
  console.log(`\nTotal cost: $${cost.toFixed(3)}  (${items.length ? (cost / items.length).toFixed(3) : 0} per report)`);
  if (labelled) console.log(`Matches ground truth: ${correct}/${labelled}`);
  if (failures.length) console.log(`Failures:\n  ${failures.join("\n  ")}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
