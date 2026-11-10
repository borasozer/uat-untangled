import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bucketHeadline, bucketLine, bucketOf, firstSentence, formatSpan } from "./labels";

describe("bucketOf", () => {
  it("puts a report that joins a known issue in Already known, whatever the relation", () => {
    assert.equal(bucketOf({ action: "link_to_ticket", relation: "different_aspect", targetOrigin: "known_issue", targetKind: "bug" }), "already_known");
  });

  it("tells the same bug from another symptom of it", () => {
    assert.equal(bucketOf({ action: "link_to_ticket", relation: "exact_duplicate", targetKind: "bug" }), "same_bug");
    assert.equal(bucketOf({ action: "link_to_ticket", relation: "different_aspect", targetKind: "bug" }), "other_symptom");
  });

  it("lets the ticket's kind decide when a report joins an idea", () => {
    assert.equal(bucketOf({ action: "link_to_ticket", targetKind: "idea", category: "bug" }), "idea");
    // The match is another report, not a ticket yet: the AI's reading decides.
    assert.equal(bucketOf({ action: "link_to_ticket", targetKind: null, category: "idea" }), "idea");
    assert.equal(bucketOf({ action: "link_to_ticket", targetKind: null, category: "bug" }), "same_bug");
  });

  it("maps the other outcomes", () => {
    assert.equal(bucketOf({ action: "create_ticket" }), "new_bug");
    assert.equal(bucketOf({ action: "ask_tester" }), "thin_evidence");
    assert.equal(bucketOf({ action: "add_to_ideas" }), "idea");
    assert.equal(bucketOf({ action: "answer", category: "question" }), "question");
    assert.equal(bucketOf({ action: "answer", category: "not_a_bug" }), "by_design");
    assert.equal(bucketOf({ action: "acknowledge" }), "nothing_to_fix");
  });
});

describe("bucketLine", () => {
  it("names the bucket and the ticket, short enough for a queue row", () => {
    assert.equal(bucketLine("same_bug", "MIA-101"), "Same bug · MIA-101");
    assert.equal(bucketLine("already_known", "MIA-090"), "Already known · MIA-090");
    assert.equal(bucketLine("thin_evidence"), "Thin evidence");
    assert.equal(bucketLine("new_bug", "MIA-102"), "New bug");
  });

  it("names a pending report as a match, since there is no ticket to add to yet", () => {
    assert.equal(bucketLine("same_bug", "FB-021"), "Same bug as FB-021");
    assert.equal(bucketLine("idea", "FB-025"), "Good idea · like FB-025");
  });
});

describe("bucketHeadline", () => {
  it("puts the bucket first, then what to do", () => {
    assert.deepEqual(bucketHeadline("new_bug", null), { title: "New bug", action: "open a ticket" });
    assert.deepEqual(bucketHeadline("same_bug", "MIA-101"), { title: "Same bug", action: "add to MIA-101" });
    assert.deepEqual(bucketHeadline("already_known", "MIA-090"), { title: "Already known", action: "link MIA-090" });
    assert.deepEqual(bucketHeadline("thin_evidence", null), { title: "Thin evidence", action: "ask the tester first" });
    assert.deepEqual(bucketHeadline("idea", null), { title: "Good idea", action: "keep it as an idea" });
    assert.deepEqual(bucketHeadline("by_design", null), { title: "Works as designed", action: "explain to the tester" });
    assert.deepEqual(bucketHeadline("nothing_to_fix", null), { title: "Nothing to fix", action: "thank the tester" });
  });

  it("names a pending report as the match, with nothing to add to yet", () => {
    assert.deepEqual(bucketHeadline("same_bug", "FB-021"), { title: "Same bug as FB-021", action: null });
  });
});

describe("cycle summary", () => {
  it("takes the first sentence of a description", () => {
    assert.equal(firstSentence("Internal tool for the team. Specialists log enquiries."), "Internal tool for the team.");
    assert.equal(firstSentence("Version 2.3 of the tool. More."), "Version 2.3 of the tool.");
    assert.equal(firstSentence("No full stop"), "No full stop");
  });

  it("writes a cycle's dates short", () => {
    assert.equal(formatSpan("2026-10-26", "2026-11-06"), "26 Oct – 6 Nov");
  });
});
