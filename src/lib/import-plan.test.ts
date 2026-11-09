import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mapColumns, parseCsv } from "./csv";
import { planImport, type ExistingReport } from "./import-plan";
import type { Person } from "./types";

const people: Person[] = [
  { id: "p1", name: "Priya Nair", role: "tester", team: "Medical Information, UK" },
  { id: "p2", name: "Tom Hughes", role: "tester", team: "Medical Information, UK" },
];
const stepIds = new Set(["TS-04.1", "TS-04.2"]);
const now = new Date("2026-11-08T15:00:00Z");

/** Plans a sheet against what exists, then saves the planned rows into `existing`, as an import would. */
function importOnce(csv: string, existing: ExistingReport[], isSample = false) {
  const [header, ...body] = parseCsv(csv);
  const plan = planImport(body, mapColumns(header), { people, stepIds, existing, isSample, now });
  existing.push(...plan.rows.map((r) => ({ ref: r.ref, text: r.text, source: "import", tester_id: r.tester_id })));
  return plan;
}
const sample = (): ExistingReport[] =>
  Array.from({ length: 32 }, (_, i) => ({ ref: `IMP-${String(i + 1).padStart(2, "0")}`, text: `sample row ${i + 1}`, source: "import", tester_id: "p1" }));

describe("planImport", () => {
  it("reads a row: tester, step, result, a UK date, and an unknown tester's name kept in the text", () => {
    const { rows } = importOnce("ID,Tester,Step,Result,Comments,Date\nUAT-1,priya nair,TS-04.1,Fail,Spinner forever,02/11/2026\nUAT-2,Sam Lee,TS 04.2,Pass,Fine,yesterday", []);
    assert.deepEqual(rows[0], { ref: "IMP-UAT-1", tester_id: "p1", step_id: "TS-04.1", text: "Spinner forever", reported_result: "fail", submitted_at: "2026-11-02T12:00:00.000Z" });
    assert.equal(rows[1].text, "Fine (reported by Sam Lee)");
    assert.equal(rows[1].tester_id, null);
    assert.equal(rows[1].submitted_at, now.toISOString());
  });

  it("does not create a row twice when a file comes again, even when its ID had to change to stay unique", () => {
    const cases: Record<string, string> = {
      "an ID already used by the sample": "ID,Tester,Comments\nIMP-05,Priya Nair,My own words about the lost work",
      "a sheet ID written like the sample's": "ID,Tester,Comments\n07,Priya Nair,Citations out of order",
      "a report reference from the app": "ID,Tester,Comments\nFB-001,Tom Hughes,Draft cut off",
      "the same ID twice in one sheet": "ID,Tester,Comments\n7,Priya Nair,First thing\n7,Priya Nair,Second thing",
      "the same words in two rows, no IDs": "Tester,Comments\nPriya Nair,Same as above\nPriya Nair,Same as above",
    };
    for (const [name, csv] of Object.entries(cases)) {
      const existing = [...sample(), { ref: "FB-001", text: "a tester's report", source: "tester", tester_id: "p2" }];
      const first = importOnce(csv, existing);
      assert.ok(first.rows.length > 0, name);
      for (let again = 0; again < 2; again++) {
        const next = importOnce(csv, existing);
        assert.equal(next.rows.length, 0, `${name}: imported again`);
        assert.ok(next.skipped.every((s) => s.reason === "already imported"), name);
      }
    }
  });

  it("keeps the same words from another tester, or under another ID, as a different report", () => {
    const existing: ExistingReport[] = [];
    importOnce("ID,Tester,Comments\nA-1,Priya Nair,Same as above", existing);
    assert.equal(importOnce("ID,Tester,Comments\nA-1,Tom Hughes,Same as above", existing).rows.length, 1);
    assert.equal(importOnce("ID,Tester,Comments\nA-2,Priya Nair,Same as above", existing).rows.length, 1);
  });

  it("skips a comment longer than the report form allows", () => {
    const plan = importOnce(`Tester,Comments\nPriya Nair,${"x".repeat(4001)}\nTom Hughes,${"y".repeat(4000)}`, []);
    assert.deepEqual(plan.skipped, [{ row: 2, reason: "comment longer than 4,000 characters" }]);
    assert.equal(plan.rows.length, 1);
  });

  it("skips the sample's rows that are already in the demo, and rows with no comment", () => {
    const plan = importOnce("ID,Tester,Comments\nIMP-01,Priya Nair,sample row 1\nIMP-40,Priya Nair,\n", sample(), true);
    assert.deepEqual(plan.skipped, [
      { row: 2, reason: "IMP-01 is already in the demo" },
      { row: 3, reason: "no comment" },
    ]);
  });
});
