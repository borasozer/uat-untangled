import sampleTruth from "../../data/sample/uat-cycle3-week2.truth.json";
import { db, must } from "./db";
import { mapColumns, parseCsv, sheetProblem } from "./csv";
import { planImport, type ExistingReport } from "./import-plan";
import type { Person, Truth } from "./types";

/**
 * Import on the server: a test run exported as CSV becomes reports in the cycle, every row in one insert under a new batch.
 * importCsvAction (app/actions.ts) checks the AI budget for every row before it calls this. No AI call happens here: the
 * import screen then sends each row to /api/analyse in its own request, four at a time, and nothing else is created until
 * a person decides each row in Review. Reading the sheet is in csv.ts; each row's tester, step, date and any reason to
 * skip it, in import-plan.ts. The bundled sample sheet is known by its name: its rows get their labels, for check:batch.
 */

export const SAMPLE_FILE = "uat-cycle3-week2.csv";

/** What the import screen shows once a sheet is in: the header each field came from (null: none) and rows skipped. */
export type ImportPreview = {
  columns: Record<string, string | null>;
  rows: number;
  skipped: { row: number; reason: string }[];
};

/**
 * Turns a spreadsheet export into feedback rows (status 'new') under a new batch.
 * Analysis happens afterwards, one request per item, so progress can be shown.
 */
export async function importCsv(
  csvText: string,
  sourceName: string,
): Promise<{ batchId: string; feedbackIds: string[]; preview: ImportPreview }> {
  const supabase = db();
  const table = parseCsv(csvText);
  const [header = [], ...body] = table;
  const map = mapColumns(header);
  // The same checks the import screen makes before anything is sent (lib/csv.ts checkSheet).
  const problem = sheetProblem(table, map);
  if (problem) throw new Error(problem);

  const cycle = must(await supabase.from("cycles").select("id").limit(1).single(), "load cycle") as { id: string };
  const people = must(await supabase.from("people").select("*"), "load people") as Person[];
  const stepIds = new Set(
    (must(await supabase.from("steps").select("id"), "load steps") as { id: string }[]).map((s) => s.id),
  );
  const existing = must(
    await supabase.from("feedback").select("ref, text, source, tester_id"),
    "load reports",
  ) as ExistingReport[];
  const isSample = sourceName === SAMPLE_FILE;
  const truth = sampleTruth as unknown as Record<string, Truth>;
  const { rows, skipped } = planImport(body, map, { people, stepIds, existing, isSample, now: new Date() });

  if (!rows.length) {
    if (isSample && skipped.length > 0 && skipped.every((s) => s.reason.endsWith("already in the demo"))) {
      throw new Error(
        "The sample has already been imported. To import it again, use Start the demo over at the bottom of the page.",
      );
    }
    if (skipped.some((s) => s.reason === "already imported") && skipped.every((s) => ["already imported", "no comment"].includes(s.reason))) {
      throw new Error("This file has already been imported: every row is already in Review or decided.");
    }
    throw new Error("No rows with comments to import.");
  }

  const batch = must(
    await supabase
      .from("batches")
      .insert({ label: sourceName.replace(/\.csv$/i, ""), source_name: sourceName, total: rows.length, status: "analysing" })
      .select("id")
      .single(),
    "create batch",
  ) as { id: string };

  let inserted: { id: string }[];
  try {
    inserted = must(
      await supabase
        .from("feedback")
        .insert(
          rows.map((r) => ({ ...r, batch_id: batch.id, cycle_id: cycle.id, source: "import", status: "new", truth: isSample ? truth[r.ref] ?? null : null })),
        )
        .select("id"),
      "insert feedback",
    ) as { id: string }[];
  } catch (e) {
    // A batch with no rows would hide the last real import: take it away again.
    await supabase.from("batches").delete().eq("id", batch.id);
    throw e;
  }

  return {
    batchId: batch.id,
    feedbackIds: inserted.map((f) => f.id),
    preview: {
      columns: Object.fromEntries(
        Object.entries(map).map(([k, idx]) => [k, idx === null ? null : header[idx]]),
      ),
      rows: rows.length,
      skipped,
    },
  };
}
