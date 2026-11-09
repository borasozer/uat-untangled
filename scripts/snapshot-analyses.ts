// Saves the current AI analyses of the seed reports to data/sample/seed-analyses.json, so starting the demo over
// restores them without paying for new API calls. Run after analysing the seed's pending reports.
// Usage: npm run snapshot
import { writeFileSync } from "node:fs";
import sample from "../data/sample/medinfo-cycle3.json";
import { db } from "../src/lib/db";

async function main() {
  const supabase = db();
  const seedRefs = sample.feedback.map((f) => f.ref);
  const { data: feedback, error } = await supabase.from("feedback").select("id, ref").in("ref", seedRefs);
  if (error) throw new Error(error.message);
  const refById = new Map((feedback ?? []).map((f) => [f.id, f.ref]));

  const { data: analyses, error: aErr } = await supabase
    .from("analyses")
    .select("feedback_id, model, prompt_version, suggestion, samples, confidence, confidence_detail, latency_ms, usage, created_at")
    .in("feedback_id", [...refById.keys()])
    .order("created_at", { ascending: false });
  if (aErr) throw new Error(aErr.message);

  // Latest analysis per report.
  const latest = new Map<string, unknown>();
  for (const a of analyses ?? []) {
    const ref = refById.get(a.feedback_id)!;
    if (!latest.has(ref)) {
      const rest: Record<string, unknown> = { ...a };
      delete rest.feedback_id;
      delete rest.created_at;
      latest.set(ref, rest);
    }
  }
  const out = {
    _about: "AI analyses of the seed's pending reports, restored by resetDemo() so demos start with suggestions ready.",
    analyses: Object.fromEntries([...latest.entries()].sort(([a], [b]) => a.localeCompare(b))),
  };
  writeFileSync("data/sample/seed-analyses.json", JSON.stringify(out, null, 2) + "\n");
  console.log(`Saved ${latest.size} analyses: ${[...latest.keys()].join(", ")}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
