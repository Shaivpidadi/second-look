import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createPipelineAdapters, resolveModelMode } from "../src/index.ts";

describe("resolveModelMode", () => {
  const saved = new Map<string, string | undefined>();
  beforeEach(() => {
    saved.clear();
    for (const name of ["MODEL_API_KEY", "META_API_KEY", "SECOND_LOOK_MODELS"]) {
      saved.set(name, process.env[name]);
      delete process.env[name];
    }
  });
  afterEach(() => {
    for (const [name, value] of saved) {
      if (value !== undefined) process.env[name] = value;
      else delete process.env[name];
    }
  });

  it("needs both the flag and a key for real mode", () => {
    assert.equal(resolveModelMode(), "stub");
    process.env.SECOND_LOOK_MODELS = "real";
    assert.equal(resolveModelMode(), "stub");
    process.env.MODEL_API_KEY = "k";
    assert.equal(resolveModelMode(), "real");
    delete process.env.MODEL_API_KEY;
    process.env.META_API_KEY = "k";
    assert.equal(resolveModelMode(), "real");
    process.env.SECOND_LOOK_MODELS = "yes";
    assert.equal(resolveModelMode(), "stub");
  });
});

describe("createPipelineAdapters", () => {
  it("selects real Spark with stub SAM/Glimmer in real mode", () => {
    const real = createPipelineAdapters("real");
    assert.equal(real.spark.name, "real");
    assert.equal(real.sam.name, "stub");
    assert.equal(real.glimmer.name, "stub");
    const stub = createPipelineAdapters("stub");
    assert.equal(stub.spark.name, "stub");
    assert.equal(stub.sam.name, "stub");
    assert.equal(stub.glimmer.name, "stub");
  });
});
