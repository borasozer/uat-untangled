// Checks the latest imported batch against its ground truth (sample data only). Read-only, free.
// Prints each row's AI suggestion, whether a careful manager would accept it, and whether reports
// of the same new problem were grouped under one ticket.
// Usage: npm run check:batch
import { acceptableDecisions, CLUSTER_TICKET } from "../src/lib/ai/expected";
import { decisionKey, type Analysis, type ConfidenceDetail } from "../src/lib/ai/schema";
import { db, must } from "../src/lib/db";
import type { Feedback } from "../src/lib/types";

type Row = Feedback & { decision: string; confidence: number; agreeing: number; samples: number; costUsd: number };

async function main() {
  const supabase = db();
  const [batch] = must(
    await supabase.from("batches").select("id, source_name, total, status, created_at").order("created_at", { ascending: false }).limit(1),
    "load batch",
  ) as { id: string; source_name: string; total: number; status: string; created_at: string }[];
  if (!batch) throw new Error("No imported batch found.");

  const feedback = must(
    await supabase.from("feedback").select("*").eq("batch_id", batch.id).order("submitted_at").order("ref"),
    "load batch feedback",
  ) as Feedback[];
  const analyses = must(
    await supabase
      .from("analyses")
      .select("feedback_id, suggestion, confidence, confidence_detail, usage, created_at")
      .in("feedback_id", feedback.map((f) => f.id))
      .order("created_at", { ascending: false }),
    "load analyses",
  ) as { feedback_id: string; suggestion: Analysis; confidence: number; confidence_detail: ConfidenceDetail; usage: { cost_usd: number | null } }[];

  const pending = must(
    await supabase.from("feedback").select("ref, truth").in("status", ["new", "awaiting_review"]),
    "load pending",
  ) as { ref: string; truth: Feedback["truth"] }[];
  const pendingClusters = Object.fromEntries(pending.map((p) => [p.ref, p.truth?.cluster ?? null]));

  const rows: Row[] = [];
  for (const f of feedback) {
    const a = analyses.find((x) => x.feedback_id === f.id);
    if (!a) continue;
    rows.push({
      ...f,
      decision: decisionKey(a.suggestion),
      confidence: a.confidence,
      agreeing: a.confidence_detail.agreeing,
      samples: a.confidence_detail.samples,
      costUsd: a.usage.cost_usd ?? 0,
    });
  }

  console.log(`Batch ${batch.source_name}: ${feedback.length} rows, ${rows.length} analysed, status ${batch.status}\n`);
  let labelled = 0;
  let right = 0;
  for (const r of rows) {
    let verdict = "";
    if (r.truth) {
      labelled++;
      const ok = acceptableDecisions(r.truth, CLUSTER_TICKET, pendingClusters, r.ref);
      if (ok.includes(r.decision)) {
        right++;
        verdict = "RIGHT";
      } else verdict = `WRONG (expected ${ok.join(" or ")})`;
    }
    console.log(
      `${r.ref.padEnd(7)} ${r.decision.padEnd(28)} ${String(Math.round(r.confidence * 100)).padStart(3)}%  ` +
        `${r.agreeing}/${r.samples}  ${verdict}`,
    );
  }

  // Grouping: every new problem (no seed ticket) should end up as one ticket, created by one row.
  const byRef = new Map(rows.map((r) => [r.ref, r]));
  const creatorOf = (r: Row, seen = new Set<string>()): string | null => {
    if (r.decision === "create_ticket" || r.decision === "add_to_ideas") return r.ref;
    const target = r.decision.startsWith("link_to_ticket:") ? r.decision.slice("link_to_ticket:".length) : null;
    if (!target || seen.has(target)) return null;
    const next = byRef.get(target);
    if (!next) return target; // an existing ticket, or a report outside this batch
    seen.add(target);
    return creatorOf(next, seen);
  };
  const clusters = new Map<string, Row[]>();
  for (const r of rows) {
    const c = r.truth?.cluster;
    const problem = r.truth?.category === "bug" || r.truth?.category === "idea";
    if (!c || !problem || CLUSTER_TICKET[c] || r.truth?.evidence === "insufficient") continue;
    clusters.set(c, [...(clusters.get(c) ?? []), r]);
  }
  console.log("\nNew problems found in this batch:");
  let grouped = 0;
  for (const [cluster, members] of clusters) {
    const roots = new Set(members.map((m) => creatorOf(m)));
    const ok = roots.size === 1 && !roots.has(null);
    if (ok) grouped++;
    console.log(
      `  ${cluster.padEnd(16)} ${members.length} report(s): ${members.map((m) => `${m.ref}->${m.decision.replace("link_to_ticket:", "")}`).join(", ")}  ${ok ? "ONE TICKET" : "SPLIT"}`,
    );
  }

  const cost = rows.reduce((s, r) => s + r.costUsd, 0);
  console.log(`\nMatches ground truth: ${right}/${labelled}`);
  console.log(`New problems grouped into one ticket: ${grouped}/${clusters.size}`);
  console.log(`Cost: $${cost.toFixed(2)} ($${(cost / Math.max(1, rows.length)).toFixed(3)} per row)`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
