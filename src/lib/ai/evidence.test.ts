import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { usableStepGuess } from "./evidence";

const steps = [{ id: "TS-04.1" }, { id: "TS-04.3" }];

describe("usableStepGuess", () => {
  it("keeps a guess only when it is a real step and the tester gave none", () => {
    assert.equal(usableStepGuess("TS-04.3", null, steps), "TS-04.3");
    assert.equal(usableStepGuess("TS-09.9", null, steps), null);
    assert.equal(usableStepGuess("TS-04.3", "TS-04.1", steps), null);
    assert.equal(usableStepGuess(null, null, steps), null);
  });
});
