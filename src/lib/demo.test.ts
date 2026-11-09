import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { shouldStartOver, type DemoState } from "./demo";

const HOUR = 60 * 60 * 1000;
const now = Date.parse("2026-11-05T12:00:00Z");
const state = (s: Partial<DemoState>): DemoState => ({ changed: false, broken: false, resetAt: null, lastActivity: null, ...s });

describe("shouldStartOver", () => {
  it("leaves a fresh demo alone", () => {
    assert.equal(shouldStartOver(state({}), now), false);
  });

  it("leaves a demo someone is using alone", () => {
    assert.equal(shouldStartOver(state({ changed: true, lastActivity: now - 10 * 60 * 1000 }), now), false);
  });

  it("starts a changed demo over after an hour without use", () => {
    assert.equal(shouldStartOver(state({ changed: true, lastActivity: now - HOUR - 1 }), now), true);
  });

  it("always repairs a broken demo", () => {
    assert.equal(shouldStartOver(state({ broken: true, lastActivity: now }), now), true);
  });
});
