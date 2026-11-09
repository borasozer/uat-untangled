import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { calibrate, calibrationInfo } from "./calibration";

// Whatever the latest measurement says, the rule holds: a rate is quoted only from five or more labelled cases.
const { bins } = calibrationInfo();
const middle = (b: (typeof bins)[number]) => (b.min + Math.min(b.max, 1)) / 2;

describe("calibrate", () => {
  for (const bin of bins) {
    it(`${Math.round(bin.min * 100)}-${Math.round(bin.max * 100)}% (${bin.n} cases): ${bin.n >= 5 ? "quotes the measured rate" : "quotes no rate"}`, () => {
      const { note, calibrated } = calibrate(middle(bin));
      if (bin.n >= 5) {
        assert.equal(calibrated, bin.correct / bin.n);
        assert.match(note ?? "", new RegExp(`were right ${bin.correct} of ${bin.n} times`));
      } else {
        assert.equal(note, null);
        assert.equal(calibrated, null);
      }
    });
  }
});
