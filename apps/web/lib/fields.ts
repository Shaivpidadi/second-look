/**
 * Human labels for field ids and audit actions. Raw ids stay in the
 * data layer (and in data attributes for tests); the visible UI only
 * ever shows these labels.
 */

const FIELD_LABELS: Record<string, string> = {
  "awb.awbNumber": "AWB number",
  "awb.weightKg": "AWB weight",
  "bol.bolNumber": "BOL number",
  "bol.carrier": "Carrier",
  "bol.consignee": "Consignee",
  "awb.consignee": "AWB consignee",
  "pod.receiverSigned": "Receiver signature",
  "bol.containerNumber": "Container number",
  "bol.cartons": "Shipped cartons",
  "bol.weightKg": "BOL weight",
  "label.sscc": "SSCC",
  "invoice.totalQty": "Invoice quantity",
  "packing.totalQty": "Packing quantity",
  "pod.receivedCartons": "Received cartons",
  "pod.exceptionNote": "Exception note",
};

function prettifySegment(segment: string): string {
  const words = segment.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * The one status vocabulary used on every screen, badge, and filter:
 * Pass, Warn, Blocked, Needs human. Unknown verdicts are capitalized.
 */
export function verdictLabel(verdict: string): string {
  if (verdict === "clean") return "Pass";
  if (verdict === "mismatch") return "Warn";
  if (verdict === "blocked") return "Blocked";
  if (verdict === "needs-human") return "Needs human";
  return verdict.charAt(0).toUpperCase() + verdict.slice(1);
}

/** Visible label for a dotted field id. Unknown ids are prettified. */
export function fieldLabel(fieldId: string): string {
  if (fieldId === "*") return "Receipt";
  const known = FIELD_LABELS[fieldId];
  if (known) return known;
  const last = fieldId.split(".").pop() ?? fieldId;
  return prettifySegment(last);
}

const BLOCK_REASONS: Record<string, string> = {
  awb_check_digit: "AWB check digit",
  container_check_digit: "Container check digit",
  sscc_check_digit: "SSCC check digit",
  count_mismatch: "Count mismatch",
  paper_mismatch: "Paper mismatch",
  missing_signature: "Unsigned delivery receipt",
};

function prettifyCode(code: string): string {
  return code.replace(/_/g, " ");
}

/** Visible label for an audit action. Unknown actions are prettified. */
export function actionLabel(action: string): string {
  if (action === "submit_allow") return "accepted";
  if (action === "claim_draft") return "claim drafted";
  if (action === "fix_proposed") return "fix proposed";
  if (action === "escalation") return "escalated to Spark";
  if (action === "flag:cross_doc") return "warned: documents disagree";
  if (action === "flag:handwriting") return "warned: handwriting";
  if (action === "needs_human:unreadable") return "sent to human: unreadable";
  if (action.startsWith("submit_block:")) {
    const rule = action.slice("submit_block:".length);
    return `blocked (${BLOCK_REASONS[rule] ?? prettifyCode(rule)})`;
  }
  return prettifyCode(action);
}
