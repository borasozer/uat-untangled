/** Minimal RFC 4180 CSV parser: quoted fields, escaped quotes, commas and newlines inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const src = text.replace(/^﻿/, "");

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

/** The column each field is in, counted from 0, or null when no header matched; mapColumns fills it. */
export type ColumnMap = {
  ref: number | null;
  tester: number | null;
  step: number | null;
  result: number | null;
  text: number | null;
  date: number | null;
};

const SYNONYMS: Record<keyof ColumnMap, string[]> = {
  ref: ["id", "ref", "reference", "row id", "feedback id"],
  tester: ["tester", "name", "reported by", "reporter", "user"],
  step: ["test step", "step", "test case", "test case id", "script step", "step id"],
  result: ["result", "pass/fail", "outcome", "status", "test result"],
  text: ["comments", "comment", "feedback", "description", "notes", "observation", "details"],
  date: ["date", "tested on", "date tested", "submitted", "timestamp"],
};

/** Guesses which column holds what, from common spreadsheet header names. */
export function mapColumns(header: string[]): ColumnMap {
  const norm = header.map((h) => h.trim().toLowerCase());
  const find = (key: keyof ColumnMap) => {
    for (const name of SYNONYMS[key]) {
      const idx = norm.indexOf(name);
      if (idx >= 0) return idx;
    }
    return null;
  };
  return {
    ref: find("ref"),
    tester: find("tester"),
    step: find("step"),
    result: find("result"),
    text: find("text"),
    date: find("date"),
  };
}

/** "TS-04.3", "ts04.3", "TS-04 step 3" and "TS-4 / 3" all read as TS|4|3: script prefix, script number, step number. */
function stepParts(raw: string): string | null {
  const m = raw.trim().match(/\b([A-Z]+)[-\s]?0*(\d{1,3})\s*(?:\.|\/|step|s)\s*0*(\d{1,3})/i);
  return m ? `${m[1].toUpperCase()}|${Number(m[2])}|${Number(m[3])}` : null;
}

/**
 * The cycle's own step a spreadsheet cell names, however it is written ("TS-04.3", "TS04.3", "TS-04 step 3",
 * "TS-4 / 3"), or null. The steps come from the cycle, so another app's numbering ("EXP-2.1") works the same way.
 */
export function normaliseStepId(raw: string, steps: Iterable<string>): string | null {
  const wanted = stepParts(raw);
  if (!wanted) return null;
  for (const id of steps) if (stepParts(id) === wanted) return id;
  return null;
}

/** A pass/fail cell as pass or fail ("Passed", "OK"; "Blocked" reads as fail), or null for anything else ("n/a"). */
export function normaliseResult(raw: string): "pass" | "fail" | null {
  const v = raw.trim().toLowerCase();
  if (["pass", "passed", "ok", "p"].includes(v)) return "pass";
  if (["fail", "failed", "f", "blocked"].includes(v)) return "fail";
  return null;
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/** A month's number from its name or a short form of it ("Nov", "Sept", "November"), or 0. */
function monthNumber(name: string): number {
  const v = name.toLowerCase().replace(/\.$/, "");
  return v.length >= 3 ? MONTHS.findIndex((m) => m.startsWith(v)) + 1 : 0;
}

/** A two-digit year as the nearest one: "26" is 2026, "99" is 1999. */
const fullYear = (y: number) => (y >= 100 ? y : y < 70 ? 2000 + y : 1900 + y);

/**
 * A date as a spreadsheet writes it, or null. ISO and machine dates ("2026-11-02", "2026/11/02", "2026-11-02 14:30",
 * "2026-11-02T14:30:00.000Z", "…+01:00"), day first as in the UK ("02/11/2026", "2.11.26", "02-11-2026") and with the
 * month's name ("2 Nov 2026", "02-Nov-26", "Mon 2 Nov 2026", "Nov 2, 2026"). A date alone is read as midday UTC, so it
 * stays the same day in London; a time without a zone is read as UTC (the same as London in winter).
 */
export function parseSheetDate(raw: string): Date | null {
  // A weekday in front ("Mon 2 Nov 2026", "Monday, 2 November 2026") says nothing more.
  const v = raw.trim().replace(/^(mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?,?\s+/i, "");
  const make = (y: number, m: number, d: number, time?: { h: number; min: number; s: number; offset: number }) => {
    const year = fullYear(y);
    const date = new Date(Date.UTC(year, m - 1, d, time?.h ?? 12, time?.min ?? 0, time?.s ?? 0) - (time?.offset ?? 0) * 60_000);
    // Reject days that roll over into the next month ("31/02/2026"); a time zone may move the instant, not the day asked for.
    const check = new Date(Date.UTC(year, m - 1, d));
    return check.getUTCMonth() === m - 1 && check.getUTCDate() === d ? date : null;
  };
  const clock = (h?: string, min?: string, s?: string, zone?: string) => {
    if (!h) return undefined;
    const z = zone && zone !== "Z" ? zone.match(/([+-])(\d{2}):?(\d{2})/) : null;
    return { h: +h, min: +min!, s: +(s ?? 0), offset: z ? (z[1] === "-" ? -1 : 1) * (+z[2] * 60 + +z[3]) : 0 };
  };
  const time = "(?:[T ](\\d{1,2}):(\\d{2})(?::(\\d{2})(?:\\.\\d+)?)?)?\\s*(Z|[+-]\\d{2}:?\\d{2})?";
  let m = v.match(new RegExp(`^(\\d{4})[-/.](\\d{1,2})[-/.](\\d{1,2})${time}$`));
  if (m) return make(+m[1], +m[2], +m[3], clock(m[4], m[5], m[6], m[7]));
  m = v.match(new RegExp(`^(\\d{1,2})[/.-](\\d{1,2})[/.-](\\d{4}|\\d{2})${time}$`));
  if (m) return make(+m[3], +m[2], +m[1], clock(m[4], m[5], m[6], m[7]));
  m = v.match(/^(\d{1,2})(?:st|nd|rd|th)?[\s-]+([a-z]{3,9}\.?)[\s,-]+(\d{4}|\d{2})$/i);
  if (m && monthNumber(m[2])) return make(+m[3], monthNumber(m[2]), +m[1]);
  m = v.match(/^([a-z]{3,9}\.?)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/i);
  if (m && monthNumber(m[1])) return make(+m[3], monthNumber(m[1]), +m[2]);
  return null;
}

/**
 * The reference a spreadsheet row keeps. Review tells a report from a ticket by its prefix (FB-, IMP-, TR-), so a
 * sheet's own ID ("UAT-014", "14") gets "IMP-" in front; the original stays readable.
 */
export function importRef(raw: string): string {
  const v = raw.trim();
  return /^(FB|IMP|TR)-/i.test(v) ? v : `IMP-${v}`;
}

/** Every row is sent to the AI, so this caps what one import can spend. The import screen states the limit. */
export const MAX_IMPORT_ROWS = 60;

/** Why a sheet cannot be imported at all, or null. */
export function sheetProblem(table: string[][], map: ColumnMap): string | null {
  if (table.length < 2) return "The file has no data rows.";
  if (map.text === null) return "Could not find a comments column. Expected a header such as 'Comments' or 'Feedback'.";
  if (table.length - 1 > MAX_IMPORT_ROWS) return `Please import at most ${MAX_IMPORT_ROWS} rows at a time.`;
  return null;
}

/** What importing a sheet would do, checked before anything is created or sent to the AI. */
export type SheetCheck = {
  problem: string | null;
  /** The sheet's header for each field, or null when no column was found. */
  columns: Record<keyof ColumnMap, string | null>;
  rows: number;
  skipped: { row: number; reason: string }[];
  /** Tester names that are not people of this cycle, each once. */
  unknownTesters: string[];
  /** Rows whose test step is not a step of this cycle's script, and a few of those cells as written. */
  unknownSteps: { rows: number; examples: string[] };
  /** Rows with a date that could not be read (they get the day of the import). */
  badDates: number;
};

/** Reads a sheet the way the import does (lib/importer.ts), without creating anything. */
export function checkSheet(text: string, people: string[], steps: string[]): SheetCheck {
  const table = parseCsv(text);
  const [header = [], ...body] = table;
  const map = mapColumns(header);
  const columns = Object.fromEntries(Object.entries(map).map(([k, i]) => [k, i === null ? null : header[i]])) as SheetCheck["columns"];
  const result: SheetCheck = { problem: sheetProblem(table, map), columns, rows: 0, skipped: [], unknownTesters: [], unknownSteps: { rows: 0, examples: [] }, badDates: 0 };
  if (result.problem) return result;
  const known = new Set(people.map((p) => p.toLowerCase()));
  // Each unknown name once, however its case is written: the first spelling is kept.
  const unknown = new Map<string, string>();
  body.forEach((cells, i) => {
    const get = (idx: number | null) => (idx === null ? "" : (cells[idx] ?? "").trim());
    if (!get(map.text)) {
      result.skipped.push({ row: i + 2, reason: "no comment" });
      return;
    }
    result.rows++;
    const tester = get(map.tester);
    if (tester && !known.has(tester.toLowerCase()) && !unknown.has(tester.toLowerCase())) unknown.set(tester.toLowerCase(), tester);
    const step = get(map.step);
    if (step && !normaliseStepId(step, steps)) {
      result.unknownSteps.rows++;
      if (result.unknownSteps.examples.length < 3 && !result.unknownSteps.examples.includes(step)) result.unknownSteps.examples.push(step);
    }
    const date = get(map.date);
    if (date && !parseSheetDate(date)) result.badDates++;
  });
  result.unknownTesters = [...unknown.values()];
  if (result.rows === 0) result.problem = "No rows with comments to import.";
  return result;
}
