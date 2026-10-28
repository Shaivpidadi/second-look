import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { trapTab } from "./focus-trap.ts";

function record(): { focus: () => void; calls: number } {
  const box = { calls: 0, focus: () => {} };
  box.focus = () => {
    box.calls += 1;
  };
  return box;
}

describe("trapTab", () => {
  it("wraps forward Tab from the last element to the first", () => {
    const [first, last] = [record(), record()];
    assert.equal(trapTab([first, last], last, false), true);
    assert.equal(first.calls, 1);
    assert.equal(last.calls, 0);
  });

  it("wraps backward Tab from the first element to the last", () => {
    const [first, last] = [record(), record()];
    assert.equal(trapTab([first, last], first, true), true);
    assert.equal(first.calls, 0);
    assert.equal(last.calls, 1);
  });

  it("leaves middle elements to the browser", () => {
    const items = [record(), record(), record()];
    assert.equal(trapTab(items, items[1], false), false);
    assert.equal(trapTab(items, items[1], true), false);
    assert.deepEqual(
      items.map((item) => item.calls),
      [0, 0, 0],
    );
  });

  it("pulls an unknown active element back inside", () => {
    const [first, last] = [record(), record()];
    assert.equal(trapTab([first, last], null, false), true);
    assert.equal(first.calls, 1);
    assert.equal(trapTab([first, last], undefined, true), true);
    assert.equal(last.calls, 1);
  });

  it("does nothing with no focusables", () => {
    assert.equal(trapTab([], null, false), false);
  });
});
