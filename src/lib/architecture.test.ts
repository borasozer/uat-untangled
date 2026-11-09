import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { TABLE_GROUPS, TABLE_NOTE } from "./architecture";
import { architectureFacts } from "./architecture-facts";

/** The tables the migrations leave behind: every `create table`, minus every `drop table`, in order. */
function migratedTables(): string[] {
  const dir = join(process.cwd(), "supabase", "migrations");
  const tables = new Set<string>();
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    const sql = readFileSync(join(dir, file), "utf8").replace(/--.*$/gm, "");
    for (const m of sql.matchAll(/\b(create|drop)\s+table\s+(?:if\s+(?:not\s+)?exists\s+)?(\w+)/gi)) {
      if (m[1].toLowerCase() === "create") tables.add(m[2]);
      else tables.delete(m[2]);
    }
  }
  return [...tables].sort();
}

test("the window lists exactly the tables in the database, each with a note", () => {
  const listed = TABLE_GROUPS.flatMap((g) => g.tables);
  assert.deepEqual([...listed].sort(), migratedTables());
  assert.equal(new Set(listed).size, listed.length);
  for (const t of listed) assert.ok(TABLE_NOTE[t], `no note for ${t}`);
});

test("the followed report comes from the saved sample data", () => {
  const { journey, samples } = architectureFacts();
  assert.equal(journey.runs.length, samples);
  assert.ok(journey.runs.every((r) => r.self >= 0 && r.self <= 100));
  assert.ok(journey.agreeing >= 1 && journey.agreeing <= journey.runs.length);
  assert.ok(journey.confidence > 0 && journey.confidence <= 1);
  assert.ok(journey.tester && journey.manager && journey.developer);
  assert.match(journey.reply, /\{ticket\}/);
  assert.ok(journey.followers.every((ref) => /^FB-\d+$/.test(ref) && ref !== journey.ref));
});

test("the trust figures are the measured ones", () => {
  const { trust } = architectureFacts();
  for (const m of [trust.measured, trust.holdout]) assert.ok(m.n > 0 && m.correct >= 0 && m.correct <= m.n);
});
