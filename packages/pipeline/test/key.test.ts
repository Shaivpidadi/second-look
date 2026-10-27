import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadDotEnv } from "../src/index.ts";

const VARS = [
  "MODEL_API_KEY",
  "META_API_KEY",
  "MODEL_API_BASE_URL",
  "SECOND_LOOK_MODELS",
  "SECOND_LOOK_CALL_BUDGET",
];

describe("loadDotEnv", () => {
  const saved = new Map<string, string | undefined>();
  beforeEach(() => {
    saved.clear();
    for (const name of VARS) {
      saved.set(name, process.env[name]);
      delete process.env[name];
    }
  });
  afterEach(() => {
    for (const name of VARS) {
      const value = saved.get(name);
      if (value !== undefined) process.env[name] = value;
      else delete process.env[name];
    }
  });

  it("loads allowlisted vars from the nearest .env without overriding", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sl-dotenv-"));
    const nested = join(dir, "a", "b");
    await mkdir(nested, { recursive: true });
    await writeFile(
      join(dir, ".env"),
      [
        "# comment",
        "MODEL_API_KEY=file-key",
        "SECOND_LOOK_MODELS=real",
        "SECOND_LOOK_CALL_BUDGET=42",
        "PATH=/should/not/apply",
        "MALFORMED LINE",
        "EMPTY=",
        "",
      ].join("\n"),
    );
    process.env.SECOND_LOOK_MODELS = "stub";
    const loaded = loadDotEnv(nested);
    assert.equal(loaded, join(dir, ".env"));
    assert.equal(process.env.MODEL_API_KEY, "file-key");
    assert.equal(process.env.SECOND_LOOK_MODELS, "stub");
    assert.equal(process.env.SECOND_LOOK_CALL_BUDGET, "42");
    assert.notEqual(process.env.PATH, "/should/not/apply");
  });

  it("strips quotes and tolerates an empty .env", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sl-dotenv-quoted-"));
    await writeFile(join(dir, ".env"), 'META_API_KEY="quoted-key"\n');
    assert.equal(loadDotEnv(dir), join(dir, ".env"));
    assert.equal(process.env.META_API_KEY, "quoted-key");
    delete process.env.META_API_KEY;
    const bare = await mkdtemp(join(tmpdir(), "sl-dotenv-bare-"));
    await writeFile(join(bare, ".env"), "# nothing here\n");
    assert.equal(loadDotEnv(bare), join(bare, ".env"));
    assert.equal(process.env.MODEL_API_KEY, undefined);
  });
});
