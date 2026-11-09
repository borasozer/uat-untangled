import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { nextLine, reportGroup, reportLabel, type MyFeedback } from "./tester-status";

const ticket = (over: Partial<NonNullable<MyFeedback["ticket"]>> = {}): NonNullable<MyFeedback["ticket"]> => ({
  id: "t1",
  key: "MIA-101",
  title: "Draft generation fails for long enquiries",
  kind: "bug",
  origin: "cycle",
  status: "open",
  status_note: null,
  assignee_id: null,
  ...over,
});

const report = (over: Partial<MyFeedback> = {}): MyFeedback =>
  ({
    id: "f1",
    ref: "FB-001",
    cycle_id: "c",
    tester_id: "T1",
    step_id: null,
    text: "It broke.",
    reported_result: null,
    source: "tester_app",
    batch_id: null,
    submitted_at: "2026-10-26T10:12:00Z",
    status: "linked",
    ticket_id: "t1",
    relation: null,
    follow_up_question: null,
    follow_up_answer: null,
    tester_message: null,
    truth: null,
    step: null,
    ticket: ticket(),
    fix: null,
    retest: null,
    retestRef: "FB-001",
    othersOnTicket: 0,
    confirmed: false,
    notYet: 0,
    reopened: null,
    managerAsked: false,
    ...over,
  }) as MyFeedback;

const fix = { fixedAt: "2026-11-06T10:00:00Z", fixedBy: "D1", note: null, passed: [], failed: [] };
const names = { D1: "Ravi Patel" };

describe("reportGroup", () => {
  it("puts what the tester has to do first", () => {
    assert.equal(reportGroup(report({ status: "needs_info", ticket: null })), "turn");
    assert.equal(reportGroup(report({ status: "ticketed", fix })), "turn");
  });

  it("names the role, not the person, while a report waits", () => {
    assert.equal(reportGroup(report({ status: "awaiting_review", ticket: null })), "waiting");
  });

  it("keeps a ticket open until every tester confirms the fix", () => {
    assert.equal(reportGroup(report()), "ticket");
    const works = { by: "T1", at: "2026-11-06T11:00:00Z", feedbackId: "f1", note: null, works: true };
    assert.equal(reportGroup(report({ fix, retest: works, notYet: 2 })), "ticket");
    assert.equal(reportGroup(report({ fix, retest: works, confirmed: true })), "done");
    assert.equal(reportGroup(report({ status: "idea" })), "done");
    assert.equal(reportGroup(report({ status: "answered", ticket: null })), "done");
  });
});

describe("reportLabel", () => {
  it("says where the report stands in plain words", () => {
    assert.equal(reportLabel(report({ status: "new", ticket: null })).text, "Not read yet");
    assert.equal(reportLabel(report({ status: "ticketed" })).text, "New bug MIA-101");
    assert.equal(reportLabel(report()).text, "Added to MIA-101");
    assert.deepEqual(reportLabel(report({ status: "ticketed", fix })), { text: "Fixed: please check", tone: "attention" });
    assert.equal(reportLabel(report({ fix, retestRef: "FB-004" })).text, "MIA-101 fixed");
  });

  it("marks a failed retest as a failure", () => {
    const broken = { by: "T1", at: "2026-11-06T11:00:00Z", feedbackId: "f1", note: "Same", works: false };
    assert.deepEqual(reportLabel(report({ fix, retest: broken })), { text: "Still broken", tone: "failure" });
  });
});

describe("nextLine", () => {
  it("says what happens next and who else reported it", () => {
    assert.equal(nextLine(report({ othersOnTicket: 1 }), names), "Waiting for a developer · you + 1 other tester");
    assert.equal(
      nextLine(report({ othersOnTicket: 3, ticket: ticket({ status: "in_progress", assignee_id: "D1" }) }), names),
      "Ravi is fixing it · you + 3 other testers",
    );
    assert.equal(nextLine(report(), names), "Waiting for a developer · only you so far");
  });

  it("treats a known issue as known", () => {
    const known = ticket({ key: "MIA-090", origin: "known_issue", status_note: "Known before this cycle." });
    assert.equal(nextLine(report({ ticket: known }), names), "Known before testing · you confirm it still happens");
  });

  it("leaves the line out where the card shows the question, the retest or the reply", () => {
    assert.equal(nextLine(report({ status: "needs_info", ticket: null }), names), null);
    assert.equal(nextLine(report({ status: "ticketed", fix }), names), null);
    assert.equal(nextLine(report({ status: "answered", ticket: null }), names), null);
  });

  it("thanks the tester once an answer to the manager's question is back with the manager", () => {
    const answered = report({ status: "awaiting_review", ticket: null, follow_up_answer: "On page 1.", managerAsked: true });
    assert.equal(nextLine(answered, names), "Thanks for your answer. The UAT manager will reply here.");
    assert.equal(reportLabel(answered).text, "Answer sent");
  });

  it("does not take the automatic check's question before sending for one from the manager", () => {
    const fresh = report({ status: "new", ticket: null, follow_up_question: "Which page?", follow_up_answer: "Page 1." });
    assert.equal(reportLabel(fresh).text, "Not read yet");
    assert.equal(nextLine(fresh, names), "The UAT manager will reply here.");
  });
});

// Every label and next-step line, one row each, so a change to any branch shows up here.
describe("every state of a report", () => {
  const works = { by: "T1", at: "2026-11-06T11:00:00Z", feedbackId: "f1", note: null, works: true };
  const broken = { ...works, works: false, note: "Same" };
  const failedBy = (by: string) => ({ feedbackId: null, by, at: "2026-11-06T12:00:00Z", note: null });
  const idea = ticket({ key: "IDEA-01", kind: "idea" });
  const rows: [string, MyFeedback, string, string, string | null][] = [
    ["closed, nothing to fix", report({ status: "acknowledged", ticket: null }), "done", "Closed: no fix needed", null],
    ["kept as an idea, first to say it", report({ status: "idea", ticket: idea }), "done", "Kept as an idea", "Kept for the product team."],
    [
      "added to someone else's idea",
      report({ ticket: idea, othersOnTicket: 1 }),
      "done",
      "Kept as an idea",
      "Kept for the product team · you + 1 other tester",
    ],
    [
      "won't fix",
      report({ ticket: ticket({ status: "wont_fix" }) }),
      "done",
      "MIA-101: won't fix",
      "Won't fix · only you so far",
    ],
    [
      "reopened",
      report({ ticket: ticket({ status: "in_progress", assignee_id: "D1" }), reopened: { at: "2026-11-06T12:00:00Z", note: null } }),
      "ticket",
      "Reopened: MIA-101",
      "Ravi is on it again · only you so far",
    ],
    [
      "confirmed by every tester",
      report({ fix, retest: works, confirmed: true }),
      "done",
      "Confirmed fixed",
      "Every tester says it works now.",
    ],
    [
      "works for this tester, two still to retest",
      report({ fix, retest: works, notYet: 2, othersOnTicket: 2 }),
      "ticket",
      "Works for you",
      "2 more testers still to retest · you + 2 other testers",
    ],
    [
      "works for this tester, another says it is broken",
      report({ fix: { ...fix, failed: [failedBy("T2")] }, retest: works, othersOnTicket: 1 }),
      "ticket",
      "Works for you",
      "Another tester says it is still broken · you + 1 other tester",
    ],
    [
      "still broken for this tester",
      report({ fix: { ...fix, failed: [failedBy("T1")] }, retest: broken }),
      "ticket",
      "Still broken",
      "The developer has been told · only you so far",
    ],
    ["the ticket cannot be found", report({ ticket: null }), "ticket", "On a ticket", null],
  ];
  for (const [what, f, group, label, line] of rows) {
    it(what, () => {
      assert.equal(reportGroup(f), group);
      assert.equal(reportLabel(f).text, label);
      assert.equal(nextLine(f, names), line);
    });
  }
});
