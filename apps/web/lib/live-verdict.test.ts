import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { LiveVerdictTracker, type LiveVerdictMessage } from "./live-verdict.ts";

function verdict(overrides: Partial<LiveVerdictMessage> = {}): LiveVerdictMessage {
  return {
    seq: 1,
    fieldId: "awb.awbNumber",
    decision: "ALLOW",
    state: "clean",
    failures: [],
    ...overrides,
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * PLAN risk 5: the form must render exactly one block and one fix even
 * when the verdict computation lags behind typing (modelled here as
 * delayed, out-of-order delivery; VERDICT_DELAY_MS=2000 in production).
 */
describe("LiveVerdictTracker", () => {
  it("renders exactly one block and one fix under an artificial verdict delay", async () => {
    const rendered: LiveVerdictMessage[] = [];
    const tracker = new LiveVerdictTracker({
      debounceMs: 20,
      onVerdict: (v) => rendered.push(v),
    });
    try {
      // Verdicts computed against newer keystrokes arrive first; older,
      // delay-lagged verdicts arrive after and must be dropped as stale.
      tracker.handle(verdict({ seq: 3, decision: "BLOCK", state: "blocked", failures: [
        {
          fieldId: "awb.awbNumber",
          rule: "awb_check_digit",
          message: "AWB check digit wrong.",
          fix: "02027342210",
        },
      ] }));
      tracker.handle(verdict({ seq: 1 }));
      tracker.handle(verdict({ seq: 2 }));
      tracker.handle(verdict({ seq: 3, decision: "ALLOW", failures: [] }));
      await sleep(60);
      assert.equal(rendered.length, 1);
      assert.equal(rendered[0]?.decision, "BLOCK");
      assert.equal(rendered[0]?.failures.length, 1);
      assert.equal(rendered[0]?.failures[0]?.fix, "02027342210");
    } finally {
      tracker.dispose();
    }
  });

  it("drops a delayed stale verdict that arrives after a newer one", async () => {
    const rendered: LiveVerdictMessage[] = [];
    const tracker = new LiveVerdictTracker({
      debounceMs: 10,
      onVerdict: (v) => rendered.push(v),
    });
    try {
      tracker.handle(verdict({ seq: 2, decision: "ALLOW" }));
      await sleep(30);
      // The seq-1 computation was slow; its verdict arrives last and loses.
      tracker.handle(verdict({ seq: 1, decision: "BLOCK", failures: [
        { fieldId: "awb.awbNumber", rule: "awb_check_digit", message: "stale", fix: "x" },
      ] }));
      await sleep(30);
      assert.equal(rendered.length, 1);
      assert.equal(rendered[0]?.decision, "ALLOW");
    } finally {
      tracker.dispose();
    }
  });

  it("debounces rapid per-field updates into one render", async () => {
    const rendered: LiveVerdictMessage[] = [];
    const tracker = new LiveVerdictTracker({
      debounceMs: 30,
      onVerdict: (v) => rendered.push(v),
    });
    try {
      tracker.handle(verdict({ seq: 1 }));
      tracker.handle(verdict({ seq: 2 }));
      tracker.handle(verdict({ seq: 3 }));
      await sleep(60);
      assert.equal(rendered.length, 1);
      assert.equal(rendered[0]?.seq, 3);
    } finally {
      tracker.dispose();
    }
  });

  it("tracks fields independently", async () => {
    const rendered: LiveVerdictMessage[] = [];
    const tracker = new LiveVerdictTracker({
      debounceMs: 10,
      onVerdict: (v) => rendered.push(v),
    });
    try {
      tracker.handle(verdict({ seq: 1, fieldId: "awb.awbNumber" }));
      tracker.handle(verdict({ seq: 2, fieldId: "label.sscc" }));
      await sleep(40);
      assert.equal(rendered.length, 2);
    } finally {
      tracker.dispose();
    }
  });
});
