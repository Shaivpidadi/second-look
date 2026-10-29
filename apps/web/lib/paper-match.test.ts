import test from "node:test";
import assert from "node:assert/strict";
import {
  canonicalFieldValue,
  canonicalPartyName,
  classifyPaperVsTyped,
  comparePaperToTyped,
  consigneeConflict,
  normalizeSigned,
  signatureFailure,
  unverifiedField,
} from "./paper-match.ts";
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

test("paper-match: consignee formatting never flags, a different party does", () => {
  assert.equal(canonicalPartyName("Blue River Distribution, Inc."), "BLUE RIVER DISTRIBUTION");
  assert.equal(canonicalPartyName("BLUE RIVER DIST. INC"), "BLUE RIVER DISTRIBUTION");
  assert.equal(canonicalPartyName("The Blue  River Distribution L.L.C."), "BLUE RIVER DISTRIBUTION");
  assert.equal(canonicalPartyName("Smith & Sons Co"), "SMITH AND SONS");
  // A name that is only a suffix keeps it rather than vanishing.
  assert.equal(canonicalPartyName("Inc"), "INC");
  assert.equal(canonicalPartyName(" ,. "), null);
  for (const typed of ["blue river distribution", "Blue River Distribution LLC", "BLUE-RIVER DISTRIBUTION CO."]) {
    assert.equal(classifyPaperVsTyped("bol.consignee", "BLUE RIVER DISTRIBUTION, INC.", typed), "match", typed);
  }
  assert.equal(classifyPaperVsTyped("bol.consignee", "BLUE RIVER DISTRIBUTION", "BLUE RIDGE DISTRIBUTION"), "mismatch");
  assert.equal(classifyPaperVsTyped("bol.consignee", "BLUE RIVER DISTRIBUTION", "NORTHWIND COMPONENTS LTD"), "mismatch");
  // One character off is a camera or typing slip: a human looks, no block.
  assert.equal(classifyPaperVsTyped("bol.consignee", "BLUE RIVER DISTRIBUTION", "BLUE RIVER DISTRIBUTlON"), "misread");
  assert.deepEqual(
    comparePaperToTyped({ "bol.consignee": "Blue River Distribution" }, { "bol.consignee": "BLUE RIDGE DISTRIBUTION" }),
    [{ fieldId: "bol.consignee", rule: "paper_mismatch", message: "Typed BLUE RIDGE DISTRIBUTION, paper says Blue River Distribution.", fix: "Blue River Distribution" }],
  );
});

test("paper-match: the air waybill consignee verifies the typed consignee when no BOL was read", () => {
  assert.equal(comparePaperToTyped({ "awb.consignee": "BLUE RIVER DISTRIBUTION" }, { "bol.consignee": "BLUE RIDGE DISTRIBUTION" }).length, 1);
  // The BOL wins when both were read.
  assert.deepEqual(
    comparePaperToTyped(
      { "bol.consignee": "BLUE RIVER DISTRIBUTION", "awb.consignee": "BLUE RIDGE DISTRIBUTION" },
      { "bol.consignee": "Blue River Distribution Inc" },
    ),
    [],
  );
  assert.equal(unverifiedField("bol.consignee", "BLUE RIVER", {}, new Set(["awb"]), "Consignee")?.message, "Consignee was not readable on the air waybill; look at it again.");
  assert.equal(unverifiedField("bol.consignee", "BLUE RIVER", { "awb.consignee": "BLUE RIVER" }, new Set(["awb"]), "Consignee"), null);
  assert.equal(unverifiedField("bol.consignee", "BLUE RIVER", {}, new Set(["pod"]), "Consignee"), null);
});

test("paper-match: consignee on BOL vs air waybill conflicts only for a different party", () => {
  assert.equal(consigneeConflict({ "bol.consignee": "BLUE RIVER DISTRIBUTION", "awb.consignee": "Blue River Distribution, Inc." }), null);
  assert.equal(consigneeConflict({ "bol.consignee": "BLUE RIVER DISTRIBUTION" }), null);
  assert.deepEqual(consigneeConflict({ "bol.consignee": "BLUE RIVER DISTRIBUTION", "awb.consignee": "BLUE RIDGE DISTRIBUTION" }), {
    fieldId: "awb.consignee",
    rule: "cross_doc",
    message: "Consignee differs: bill of lading says BLUE RIVER DISTRIBUTION, air waybill says BLUE RIDGE DISTRIBUTION.",
  });
});

test("paper-match: delivery receipt signature blocks when blank, abstains when unknown", () => {
  assert.equal(normalizeSigned(" Yes "), "yes");
  assert.equal(normalizeSigned("blank"), "no");
  assert.equal(normalizeSigned("maybe"), null);
  const pod = new Set(["pod"]);
  assert.equal(signatureFailure({ "pod.receiverSigned": "no" }, pod)?.rule, "missing_signature");
  assert.equal(signatureFailure({ "pod.receiverSigned": "yes" }, pod), null);
  assert.equal(signatureFailure({}, pod)?.rule, "unreadable");
  assert.equal(signatureFailure({ "pod.receiverSigned": "smudged" }, pod)?.rule, "unreadable");
  // Only a delivery receipt carries the check.
  assert.equal(signatureFailure({}, new Set(["bol"])), null);
});

test("gate: an unsigned delivery receipt blocks live typing and submit", () => {
  const paper = { "pod.receiverSigned": "no", "pod.receivedCartons": "120" };
  const live = evaluatePartialSubmission({ "bol.cartons": "120" }, paper);
  assert.equal(live.decision, "BLOCK");
  assert.deepEqual(live.failures.map((f) => [f.fieldId, f.rule]), [["pod.receiverSigned", "missing_signature"]]);
  const values = {
    "awb.awbNumber": "02027342210",
    "bol.containerNumber": "CSQU3054383",
    "label.sscc": "106141410000001238",
    "bol.cartons": "120",
    "pod.receivedCartons": "120",
  };
  assert.equal(evaluateSubmission(values, paper).decision, "BLOCK");
  assert.equal(evaluateSubmission(values, { ...paper, "pod.receiverSigned": "yes" }).decision, "ALLOW");
  // Wrong consignee blocks submit with the paper name as the fix.
  const wrong = evaluateSubmission({ ...values, "bol.consignee": "BLUE RIDGE DISTRIBUTION" }, { "bol.consignee": "BLUE RIVER DISTRIBUTION" });
  assert.deepEqual(wrong.failures.map((f) => [f.fieldId, f.fix]), [["bol.consignee", "BLUE RIVER DISTRIBUTION"]]);
});

test("paper-match: look-alike characters on a reference number are a misread, not a block", () => {
  assert.equal(classifyPaperVsTyped("bol.bolNumber", "BOI-00421307", "BOL-00421307"), "misread");
  assert.equal(classifyPaperVsTyped("bol.bolNumber", "BOL-0O421307", "BOL-00421307"), "misread");
  assert.deepEqual(comparePaperToTyped({ "bol.bolNumber": "BOI-00421307" }, { "bol.bolNumber": "BOL-00421307" }), []);
  assert.equal(unverifiedField("bol.bolNumber", "BOL-00421307", { "bol.bolNumber": "BOI-00421307" }, new Set(["bol"]), "BOL number")?.rule, "unreadable");
  // Transposed digits are still a real mismatch.
  assert.equal(classifyPaperVsTyped("bol.bolNumber", "BOL-00421307", "BOL-00421370"), "mismatch");
});
