import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { samCostUsd, sparkCostUsd } from "../src/index.ts";

describe("sparkCostUsd", () => {
  it("prices fresh, cached, and output tokens at official rates", () => {
    assert.equal(sparkCostUsd(1_000_000, 0, 0), 1.25);
    assert.equal(sparkCostUsd(0, 1_000_000, 0), 4.25);
    assert.equal(sparkCostUsd(1_000_000, 0, 1_000_000), 0.15);
    assert.equal(sparkCostUsd(1000, 1000, 400), 600 * 1.25e-6 + 400 * 0.15e-6 + 1000 * 4.25e-6);
    assert.equal(sparkCostUsd(0, 0), 0);
  });

  it("clamps cached tokens to the input total", () => {
    assert.equal(sparkCostUsd(100, 0, 500), 100 * 0.15e-6);
  });
});

describe("samCostUsd", () => {
  it("prices images and video frames", () => {
    assert.equal(samCostUsd(1000), 2.5);
    assert.equal(samCostUsd(1), 0.0025);
    assert.equal(samCostUsd(0, 50), 50 * 0.0002);
  });
});
