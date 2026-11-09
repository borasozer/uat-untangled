import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkSheet, importRef, mapColumns, normaliseResult, normaliseStepId, parseCsv, parseSheetDate } from "./csv";

describe("parseCsv", () => {
  it("handles quoted fields with commas, escaped quotes and line breaks", () => {
    const rows = parseCsv('ID,Comments\r\nR1,"Clicked ""Save"", then\nnothing"\nR2,ok\n');
    assert.deepEqual(rows, [
      ["ID", "Comments"],
      ["R1", 'Clicked "Save", then\nnothing'],
      ["R2", "ok"],
    ]);
  });

  it("drops a byte order mark and empty lines", () => {
    assert.deepEqual(parseCsv("﻿a,b\n\n,\n1,2"), [
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});

describe("mapColumns", () => {
  it("recognises common header names in any case", () => {
    const map = mapColumns(["Feedback ID", "Reported by", "Test Case", "Pass/Fail", "Description", "Tested on"]);
    assert.deepEqual(map, { ref: 0, tester: 1, step: 2, result: 3, text: 4, date: 5 });
  });

  it("leaves a missing column empty", () => {
    assert.equal(mapColumns(["Comments"]).step, null);
  });
});

describe("normaliseStepId and normaliseResult", () => {
  it("reads the ways people write a step, as one of the cycle's own steps", () => {
    const steps = ["TS-04.2", "TS-04.3", "TS-05.1"];
    for (const raw of ["TS-04.3", "TS04.3", "TS-04 step 3", "ts-4 / 3"]) assert.equal(normaliseStepId(raw, steps), "TS-04.3");
    assert.equal(normaliseStepId("step three", steps), null);
    assert.equal(normaliseStepId("TS-09.1", steps), null);
  });

  it("follows another app's numbering", () => {
    assert.equal(normaliseStepId("exp 2 step 1", ["EXP-02.1", "EXP-02.2"]), "EXP-02.1");
  });

  it("reads pass and fail", () => {
    assert.equal(normaliseResult(" Passed "), "pass");
    assert.equal(normaliseResult("Blocked"), "fail");
    assert.equal(normaliseResult("n/a"), null);
  });
});

describe("parseSheetDate", () => {
  const day = (raw: string) => parseSheetDate(raw)?.toISOString().slice(0, 10) ?? null;

  it("reads ISO dates, with or without a time", () => {
    assert.equal(day("2026-11-02"), "2026-11-02");
    assert.equal(parseSheetDate("2026-11-02 14:30")?.toISOString(), "2026-11-02T14:30:00.000Z");
  });

  it("reads a numeric date day first, as in the UK", () => {
    for (const raw of ["02/11/2026", "2/11/2026", "02-11-2026", "2.11.26"]) assert.equal(day(raw), "2026-11-02", raw);
  });

  it("reads a date with the month's name", () => {
    for (const raw of ["2 Nov 2026", "2nd November 2026", "Nov 2, 2026", "November 2 2026"]) assert.equal(day(raw), "2026-11-02", raw);
  });

  it("keeps a date alone on the same day in London", () => {
    assert.equal(parseSheetDate("02/11/2026")?.toISOString(), "2026-11-02T12:00:00.000Z");
  });

  it("reads machine dates: slashes, fractions of a second, a time zone", () => {
    assert.equal(day("2026/11/02"), "2026-11-02");
    assert.equal(parseSheetDate("2026-11-02T14:30:00.000Z")?.toISOString(), "2026-11-02T14:30:00.000Z");
    assert.equal(parseSheetDate("2026-11-02T14:30:00+01:00")?.toISOString(), "2026-11-02T13:30:00.000Z");
    assert.equal(parseSheetDate("2026-11-02 14:30:00.123")?.toISOString(), "2026-11-02T14:30:00.000Z");
  });

  it("reads a short year and a weekday in front", () => {
    for (const raw of ["02-Nov-26", "2 Nov 26", "Mon 2 Nov 2026", "Monday, 2 November 2026"]) assert.equal(day(raw), "2026-11-02", raw);
    assert.equal(day("2 Sept 2026"), "2026-09-02");
    assert.equal(day("02/11/99"), "1999-11-02");
  });

  it("gives null for what it cannot read, and for days that do not exist", () => {
    for (const raw of ["", "yesterday", "31/02/2026", "13/13/2026", "2 Smarch 2026", "2 Marchy 2026"]) assert.equal(parseSheetDate(raw), null, raw);
  });
});

describe("importRef", () => {
  it("keeps a reference Review already knows, and marks another sheet's own ID as an imported report", () => {
    assert.equal(importRef("IMP-07"), "IMP-07");
    assert.equal(importRef(" FB-031 "), "FB-031");
    assert.equal(importRef("UAT-014"), "IMP-UAT-014");
    assert.equal(importRef("14"), "IMP-14");
  });
});

describe("checkSheet", () => {
  const people = ["Priya Nair", "Tom Hughes"];
  const steps = ["TS-04.1", "TS-04.2"];

  it("counts what would go wrong, before anything is imported", () => {
    const csv = [
      "Ref,Tester,Step,Notes,Date",
      "1,Priya Nair,TS-04.1,Draft never finishes,02/11/2026",
      "2,Sam Lee,TS-04-1,Spinner forever,someday",
      "3,sam lee,TS-09.9,Cut off,2 Nov 2026",
      "4,Tom Hughes,TS-04.2,,02/11/2026",
    ].join("\n");
    const r = checkSheet(csv, people, steps);
    assert.equal(r.problem, null);
    assert.equal(r.rows, 3);
    assert.deepEqual(r.skipped, [{ row: 5, reason: "no comment" }]);
    assert.deepEqual(r.unknownTesters, ["Sam Lee"]);
    assert.deepEqual(r.unknownSteps, { rows: 2, examples: ["TS-04-1", "TS-09.9"] });
    assert.equal(r.badDates, 1);
    assert.deepEqual(r.columns, { ref: "Ref", tester: "Tester", step: "Step", result: null, text: "Notes", date: "Date" });
  });

  it("says why a sheet cannot be imported at all", () => {
    assert.match(checkSheet("ID,Tester\n1,Priya", people, steps).problem ?? "", /comments column/);
    assert.match(checkSheet("Tester,Comments\nPriya Nair,\nTom Hughes,  \n", people, steps).problem ?? "", /No rows with comments/);
    assert.match(checkSheet("Comments", people, steps).problem ?? "", /no data rows/);
    const many = ["Comments", ...Array.from({ length: 61 }, (_, i) => `row ${i}`)].join("\n");
    assert.match(checkSheet(many, people, steps).problem ?? "", /at most 60 rows/);
  });
});
