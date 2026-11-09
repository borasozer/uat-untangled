import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { keyPattern, nextTicketKey } from "./ticket-key";

describe("nextTicketKey", () => {
  it("follows the cycle's own numbering for bugs", () => {
    const keys = [
      { key: "MIA-090", kind: "bug" as const },
      { key: "MIA-101", kind: "bug" as const },
      { key: "MIA-105", kind: "bug" as const },
      { key: "IDEA-01", kind: "idea" as const },
    ];
    assert.equal(nextTicketKey(keys, "bug"), "MIA-106");
    assert.equal(nextTicketKey(keys, "idea"), "IDEA-02");
  });

  it("starts cycle tickets at 101, after the known issues", () => {
    assert.equal(nextTicketKey([{ key: "EXP-012", kind: "bug" }], "bug"), "EXP-101");
  });

  it("works for a cycle with no tickets yet", () => {
    assert.equal(nextTicketKey([], "bug"), "BUG-101");
    assert.equal(nextTicketKey([], "idea"), "IDEA-01");
  });

  it("breaks a tie between prefixes the same way every time", () => {
    const a = [
      { key: "AAA-101", kind: "bug" as const },
      { key: "BBB-150", kind: "bug" as const },
    ];
    assert.equal(nextTicketKey(a, "bug"), "AAA-102");
    assert.equal(nextTicketKey([...a].reverse(), "bug"), "AAA-102");
  });
});

describe("keyPattern", () => {
  it("finds keys with the cycle's own prefix, ideas and report refs, but not other ids", () => {
    const found = (text: string) => [...text.matchAll(keyPattern(["EXP-101", "EXP-007"]))].map((m) => m[0]);
    assert.deepEqual(found("Added to EXP-102, like IDEA-03 and FB-021; enquiry MI-20417."), ["EXP-102", "IDEA-03", "FB-021"]);
    assert.deepEqual(found("See MIA-101."), []);
  });
});

