import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fixState, isConfirmed, notYetRetested, reopenReason, reopenState } from "./ticket-work";
import type { TicketEvent } from "./types";

let n = 0;
const event = (kind: TicketEvent["kind"], at: string, by: string | null, feedback: string | null = null): TicketEvent => ({
  id: `e${++n}`,
  ticket_id: "t1",
  kind,
  feedback_id: feedback,
  note: null,
  by_id: by,
  at,
});

const report = (tester: string | null, at = "2026-10-28T10:00:00Z") => ({ tester_id: tester, submitted_at: at });

describe("fixState", () => {
  it("is null until the ticket has been marked fixed", () => {
    assert.equal(fixState([event("picked_up", "2026-11-01T09:00:00Z", "D1")]), null);
  });

  it("counts only answers since the latest fix, and each tester's first answer", () => {
    const fix = fixState([
      event("fixed", "2026-11-01T09:00:00Z", "D1"),
      event("retest_failed", "2026-11-01T10:00:00Z", "T1", "f1"),
      event("reopened", "2026-11-01T11:00:00Z", "D1"),
      event("fixed", "2026-11-02T09:00:00Z", "D1"),
      event("retest_passed", "2026-11-02T10:00:00Z", "T1", "f1"),
      event("retest_failed", "2026-11-02T10:00:01Z", "T1", "f1"),
    ]);
    assert.equal(fix?.fixedAt, "2026-11-02T09:00:00Z");
    assert.deepEqual(
      fix?.passed.map((p) => p.by),
      ["T1"],
    );
    assert.equal(fix?.failed.length, 0);
  });
});

describe("isConfirmed and notYetRetested", () => {
  const fixed = event("fixed", "2026-11-02T09:00:00Z", "D1");

  it("waits for every tester who reported the ticket", () => {
    const fix = fixState([fixed, event("retest_passed", "2026-11-02T10:00:00Z", "T1", "f1")]);
    const reports = [report("T1"), report("T2"), report("T2")];
    assert.equal(isConfirmed(fix, reports), false);
    assert.equal(notYetRetested(fix, reports), 1);
  });

  it("is confirmed when all of them say it works", () => {
    const fix = fixState([
      fixed,
      event("retest_passed", "2026-11-02T10:00:00Z", "T1", "f1"),
      event("retest_passed", "2026-11-02T11:00:00Z", "T2", "f2"),
    ]);
    assert.equal(isConfirmed(fix, [report("T1"), report("T2")]), true);
    assert.equal(notYetRetested(fix, [report("T1"), report("T2")]), 0);
  });

  it("is not confirmed if anyone says it is still broken", () => {
    const fix = fixState([
      fixed,
      event("retest_passed", "2026-11-02T10:00:00Z", "T1", "f1"),
      event("retest_failed", "2026-11-02T11:00:00Z", "T2", "f2"),
    ]);
    assert.equal(isConfirmed(fix, [report("T1"), report("T2")]), false);
  });

  it("is not confirmed when a report arrived after the fix", () => {
    const fix = fixState([fixed, event("retest_passed", "2026-11-02T10:00:00Z", "T1", "f1")]);
    assert.equal(isConfirmed(fix, [report("T1"), report("T1", "2026-11-02T12:00:00Z")]), false);
  });

  it("ignores imported reports with no known tester, who cannot be asked", () => {
    const fix = fixState([fixed, event("retest_passed", "2026-11-02T10:00:00Z", "T1", "f1")]);
    assert.equal(isConfirmed(fix, [report("T1"), report(null)]), true);
    assert.equal(isConfirmed(fix, [report(null)]), false);
  });
});

describe("reopenReason", () => {
  it("only reports a reopen that is the latest thing to happen", () => {
    const reopened = event("reopened", "2026-11-02T11:00:00Z", "D1");
    assert.equal(reopenReason([event("fixed", "2026-11-02T09:00:00Z", "D1"), reopened])?.at, reopened.at);
    assert.equal(reopenReason([reopened, event("fixed", "2026-11-02T12:00:00Z", "D1")]), null);
  });
});

describe("reopenState", () => {
  it("keeps why it was reopened and who still found it broken, while it is being worked on again", () => {
    const broken = { ...event("retest_failed", "2026-11-02T10:00:00Z", "T3", "f3"), note: "Still cut off after question 3." };
    const state = reopenState([
      event("fixed", "2026-11-02T09:00:00Z", "D1"),
      event("retest_passed", "2026-11-02T09:30:00Z", "T1", "f1"),
      broken,
      { ...event("reopened", "2026-11-02T11:00:00Z", "D1"), note: "Fixing the chunking." },
    ]);
    assert.equal(state?.note, "Fixing the chunking.");
    assert.deepEqual(
      state?.failed.map((f) => [f.by, f.note]),
      [["T3", "Still cut off after question 3."]],
    );
  });

  it("is null once something else has happened since the reopen", () => {
    assert.equal(
      reopenState([event("fixed", "2026-11-02T09:00:00Z", "D1"), event("reopened", "2026-11-02T11:00:00Z", "D1"), event("fixed", "2026-11-03T09:00:00Z", "D1")]),
      null,
    );
  });
});
