import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { HEADLINES } from "../headlines.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function collapsed(file: string): string {
  return readFileSync(join(ROOT, file), "utf8").replace(/\s+/g, " ");
}

describe("headline numbers agree across docs", () => {
  for (const headline of HEADLINES) {
    for (const quote of headline.quotes) {
      it(`${quote.file} quotes "${quote.text}" (${headline.source})`, () => {
        const body = collapsed(quote.file);
        const want = quote.text.replace(/\s+/g, " ");
        assert.ok(
          body.includes(want),
          `${quote.file} drifted from ${headline.source}: missing "${quote.text}"`,
        );
      });
    }
  }
});
