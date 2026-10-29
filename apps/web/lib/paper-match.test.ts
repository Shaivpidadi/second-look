import test from "node:test";
import assert from "node:assert/strict";
import { canonicalFieldValue, classifyPaperVsTyped, comparePaperToTyped, unverifiedField } from "./paper-match.ts";
import { evaluatePartialSubmission, evaluateSubmission } from "./gate.ts";

test("paper-match: formatting never counts as a mismatch", () => {
  assert.equal(canonicalFieldValue("awb.awbNumber", "020-2734 2210"), "02027342210");
  assert.equal(canonicalFieldValue("label.sscc", "(00) 106141410000001238"), "106141410000001238");
  assert.equal(canonicalFieldValue("bol.cartons", "120 CTNS"), "120");
  assert.equal(canonicalFieldValue("bol.cartons", "1,200"), "1200");
  assert.equal(canonicalFieldValue("bol.bolNumber", "bol 00421307"), "BOL00421307");
  assert.equal(canonicalFieldValue("bol.carrier", "  "), null);
  assert.deepEqual(
    comparePaperToTyped(
      { "awb.awbNumber": "020-2734 2210", "bol.carrier": "Harbour Line Goods" },
      { "awb.awbNumber": "02027342210", "bol.carrier": "HARBOUR LINE GOODS" },
    ),
    [],
  );
});

test("paper-match: flags only fields known on both sides, fix is the paper", () => {
  const out = comparePaperToTyped(
    { "bol.cartons": "120", "bol.bolNumber": "BOL-00421307" },
    { "bol.cartons": "102", "awb.awbNumber": "02027342280", "bol.bolNumber": "" },
  );
  assert.deepEqual(out, [
    { fieldId: "bol.cartons", rule: "paper_mismatch", message: "Typed 102, paper says 120.", fix: "120" },
  ]);
});

test("gate: paper memory blocks live typing and submit with the paper fix", () => {
  const paper = { "awb.awbNumber": "020-2734 2210", "bol.containerNumber": "CSQU3054383" };
  const live = evaluatePartialSubmission({ "bol.containerNumber": "CSQU3054830" }, paper);
  assert.equal(live.decision, "BLOCK");
  assert.deepEqual(live.failures.map((f) => [f.fieldId, f.rule, f.fix]), [
    ["bol.containerNumber", "paper_mismatch", "CSQU3054383"],
  ]);
  // Swapped digits fail the check digit; the fix is the paper, not a recomputed digit.
  const swapped = evaluatePartialSubmission({ "awb.awbNumber": "02027432210" }, paper);
  assert.ok(swapped.failures.every((f) => f.fix === "02027342210"));
  assert.deepEqual(swapped.failures.map((f) => f.rule), ["awb_check_digit", "paper_mismatch"]);
  const clean = evaluatePartialSubmission({ "bol.containerNumber": "CSQU3054383" }, paper);
  assert.equal(clean.decision, "ALLOW");
  const submit = evaluateSubmission(
    {
      "awb.awbNumber": "02027342280",
      "bol.containerNumber": "CSQU3054383",
      "label.sscc": "106141410000001238",
      "bol.cartons": "120",
      "pod.receivedCartons": "120",
    },
    paper,
  );
  assert.equal(submit.decision, "BLOCK");
  assert.deepEqual(submit.failures.map((f) => f.fieldId), ["awb.awbNumber"]);
});

test("paper-match: a number cut off at the frame edge is not a mismatch", () => {
  assert.deepEqual(comparePaperToTyped({ "awb.awbNumber": "20-2734 2210" }, { "awb.awbNumber": "02027342210" }), []);
  assert.equal(comparePaperToTyped({ "awb.awbNumber": "020-2734 2280" }, { "awb.awbNumber": "02027342210" }).length, 1);
});

test("paper-match: a typed field whose document was seen but not read abstains", () => {
  const seen = new Set(["bol"]);
  assert.equal(unverifiedField("bol.containerNumber", "CSQU3054830", {}, seen, "Container number")?.rule, "unreadable");
  assert.equal(unverifiedField("bol.containerNumber", "CSQU3054830", { "bol.containerNumber": "CSQU3054383" }, seen, "x"), null);
  assert.equal(unverifiedField("awb.awbNumber", "02027342210", {}, seen, "x"), null);
  assert.equal(unverifiedField("pod.exceptionNote", "2 damaged", {}, new Set(["pod"]), "x"), null);
});

test("paper-match: classify separates clipped numbers from real mismatches", () => {
  assert.equal(classifyPaperVsTyped("awb.awbNumber", "20-2734 2210", "02027342210"), "cut-off");
  assert.equal(classifyPaperVsTyped("awb.awbNumber", "020-2734 2210", "02027342210"), "match");
  assert.equal(classifyPaperVsTyped("bol.cartons", "120 CTNS", "102"), "mismatch");
});

test("paper-match: a paper read that fails its own check digit is a misread, not a block", () => {
  assert.equal(classifyPaperVsTyped("bol.containerNumber", "CBQU03054383", "CSQU3054383"), "misread");
  assert.deepEqual(comparePaperToTyped({ "bol.containerNumber": "CBQU03054383" }, { "bol.containerNumber": "CSQU3054383" }), []);
  assert.equal(
    unverifiedField("bol.containerNumber", "CSQU3054383", { "bol.containerNumber": "CBQU03054383" }, new Set(["bol"]), "Container")?.rule,
    "unreadable",
  );
  // A valid printed number that differs is still a real mismatch.
  assert.equal(classifyPaperVsTyped("bol.containerNumber", "CSQU3054383", "CSQU3054830"), "mismatch");
});
