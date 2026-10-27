import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  __resetLiveVerdictBus,
  currentSeq,
  publishLiveVerdict,
  subscribeLiveVerdicts,
  type PublishedVerdict,
} from "./verdict-bus.ts";

describe("verdict bus", () => {
  beforeEach(() => {
    __resetLiveVerdictBus();
  });

  it("assigns incrementing sequence numbers per session", () => {
    const first = publishLiveVerdict("s1", {
      fieldId: "awb.awbNumber",
      decision: "ALLOW",
      state: "clean",
      failures: [],
      ts: new Date().toISOString(),
    });
    const second = publishLiveVerdict("s1", {
      fieldId: "awb.awbNumber",
      decision: "BLOCK",
      state: "blocked",
      failures: [],
      ts: new Date().toISOString(),
    });
    assert.equal(first.seq, 1);
    assert.equal(second.seq, 2);
    assert.equal(currentSeq("s1"), 2);
    assert.equal(currentSeq("unknown"), 0);
  });

  it("sequences sessions independently", () => {
    publishLiveVerdict("s1", {
      fieldId: "f",
      decision: "ALLOW",
      state: "clean",
      failures: [],
      ts: "t",
    });
    const other = publishLiveVerdict("s2", {
      fieldId: "f",
      decision: "ALLOW",
      state: "clean",
      failures: [],
      ts: "t",
    });
    assert.equal(other.seq, 1);
  });

  it("fans out to subscribers until they unsubscribe", () => {
    const seenA: PublishedVerdict[] = [];
    const seenB: PublishedVerdict[] = [];
    const stopA = subscribeLiveVerdicts("s1", (v) => seenA.push(v));
    subscribeLiveVerdicts("s1", (v) => seenB.push(v));
    subscribeLiveVerdicts("s2", () => {
      throw new Error("wrong session notified");
    });
    publishLiveVerdict("s1", {
      fieldId: "f",
      decision: "ALLOW",
      state: "clean",
      failures: [],
      ts: "t",
    });
    stopA();
    publishLiveVerdict("s1", {
      fieldId: "f",
      decision: "ALLOW",
      state: "clean",
      failures: [],
      ts: "t",
    });
    assert.equal(seenA.length, 1);
    assert.equal(seenB.length, 2);
  });
});
