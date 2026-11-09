import { importRef, normaliseResult, normaliseStepId, parseSheetDate, type ColumnMap } from "./csv";
import type { Person } from "./types";

/** A report already in the cycle, as far as an import needs to know it. */
export type ExistingReport = { ref: string; text: string; source: string; tester_id: string | null };

/** The longest comment a row may have: the same limit as the report form. Every waiting report goes into each AI
 *  call, so one huge cell would slow down and raise the cost of every analysis in the shared demo. */
export const MAX_COMMENT_CHARS = 4000;

/** One spreadsheet row as it will be saved (status "new"; the batch, cycle and truth are added by the importer). */
export type PlannedRow = {
  ref: string;
  tester_id: string | null;
  step_id: string | null;
  text: string;
  reported_result: "pass" | "fail" | null;
  submitted_at: string;
};

/**
 * What importing a sheet's rows would create, without touching the database: each row's reference, tester, step,
 * result and date, and the rows skipped with the reason. A row already brought in from a sheet (the same tester and
 * text, and the same ID when the sheet has one, even if that ID had to be changed to stay unique) is skipped, so
 * importing a file again neither creates its rows twice nor pays the AI twice.
 */
export function planImport(
  body: string[][],
  map: ColumnMap,
  { people, stepIds, existing, isSample, now }: { people: Person[]; stepIds: Set<string>; existing: ExistingReport[]; isSample: boolean; now: Date },
): { rows: PlannedRow[]; skipped: { row: number; reason: string }[] } {
  const existingRefs = new Set(existing.map((f) => f.ref));
  const key = (testerId: string | null, text: string) => `${testerId ?? ""}\u0000${text}`;
  const imported = new Map<string, string[]>();
  for (const f of existing) {
    if (f.source !== "import") continue;
    const k = key(f.tester_id, f.text);
    imported.set(k, [...(imported.get(k) ?? []), f.ref]);
  }
  const skipped: { row: number; reason: string }[] = [];
  const rows: PlannedRow[] = [];
  let counter = existingRefs.size + 1;

  body.forEach((cells, i) => {
    const get = (idx: number | null) => (idx === null ? "" : (cells[idx] ?? "").trim());
    const text = get(map.text);
    if (!text) {
      skipped.push({ row: i + 2, reason: "no comment" });
      return;
    }
    if (text.length > MAX_COMMENT_CHARS) {
      skipped.push({ row: i + 2, reason: "comment longer than 4,000 characters" });
      return;
    }
    const testerName = get(map.tester);
    const tester = people.find((p) => p.name.toLowerCase() === testerName.toLowerCase());
    // Keep an unknown tester's name in the text so nothing is lost.
    const stored = tester || !testerName ? text : `${text} (reported by ${testerName})`;
    const sheetRef = get(map.ref);
    let ref = sheetRef ? importRef(sheetRef) : `IMP-${String(counter++).padStart(3, "0")}`;
    const before = imported.get(key(tester?.id ?? null, stored));
    if (!isSample && before && (!sheetRef || before.some((r) => r === ref || r.startsWith(`${ref}-`)))) {
      skipped.push({ row: i + 2, reason: "already imported" });
      return;
    }
    if (existingRefs.has(ref)) {
      if (isSample) {
        skipped.push({ row: i + 2, reason: `${ref} is already in the demo` });
        return;
      }
      ref = `${ref}-${counter++}`;
    }
    existingRefs.add(ref);
    // UK day-first dates are read as such; a date that cannot be read gets the day of the import.
    const date = parseSheetDate(get(map.date));
    rows.push({
      ref,
      tester_id: tester?.id ?? null,
      step_id: normaliseStepId(get(map.step), stepIds),
      text: stored,
      reported_result: normaliseResult(get(map.result)),
      submitted_at: (date ?? now).toISOString(),
    });
  });
  return { rows, skipped };
}
