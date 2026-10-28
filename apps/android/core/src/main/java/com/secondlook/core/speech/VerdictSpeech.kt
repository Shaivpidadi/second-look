package com.secondlook.core.speech

import com.secondlook.core.api.LiveVerdict

/**
 * Spoken verdict phrases, pure JVM so :core unit tests cover them.
 * Only mismatch and blocked verdicts speak; everything else returns
 * null and the app decides between a short tone and silence.
 */
private val FIELD_LABELS = mapOf(
    "awb.awbNumber" to "Air waybill number",
    "bol.bolNumber" to "Bill of lading number",
    "bol.containerNumber" to "Container number",
    "label.sscc" to "S S C C",
    "bol.cartons" to "Shipped cartons",
    "pod.receivedCartons" to "Received cartons",
    "pod.exceptionNote" to "Delivery note",
    "invoice.totalQty" to "Invoice quantity",
    "packing.totalQty" to "Packing quantity",
    "bol.weightKg" to "Bill of lading weight",
    "awb.weightKg" to "Air waybill weight",
)

private val DOC_LABELS = mapOf(
    "bol" to "bill of lading",
    "awb" to "air waybill",
    "invoice" to "invoice",
    "packing" to "packing list",
    "pod" to "proof of delivery",
    "label" to "pallet label",
)

/** Spoken label for a field id, with a camel-splitting fallback. */
fun fieldLabel(fieldId: String): String {
    FIELD_LABELS[fieldId]?.let { return it }
    val last = fieldId.substringAfterLast(".")
    val words = last.replace(Regex("(?<=[a-z])(?=[A-Z])"), " ").lowercase()
    return words.replaceFirstChar { it.uppercase() }.ifEmpty { "Field" }
}

/** Spoken label for a document prefix, falling back to "document". */
fun docLabel(fieldId: String): String {
    val prefix = fieldId.substringBefore(".", "")
    return DOC_LABELS[prefix] ?: "document"
}

/**
 * Short plain phrase for one verdict, or null when it should stay
 * silent (clean, needs-human, throttled). Only the first failure is
 * spoken; the rest are counted.
 */
fun phraseFor(verdict: LiveVerdict): String? {
    if (verdict.state != "mismatch" && verdict.state != "blocked") return null
    val first = verdict.failures.firstOrNull() ?: return null
    val field = fieldLabel(first.fieldId)
    val head = when (first.rule) {
        "field_match" -> "$field does not match the ${docLabel(first.fieldId)}."
        "check_digit" -> "$field has a wrong check digit."
        "cross_doc" -> "$field differs between documents."
        else -> "$field needs attention."
    }
    val rest = verdict.failures.size - 1
    if (rest <= 0) return head
    val noun = if (rest == 1) "issue" else "issues"
    return "$head Plus $rest more $noun."
}

/**
 * Suppresses repeat speech for identical verdicts inside a window.
 * shouldSpeak records every verdict it accepts; different verdicts
 * always speak.
 */
class SpeakDebounce(private val windowMs: Long = 30_000) {
    private var lastKey: String? = null
    private var lastMs: Long = 0

    fun keyFor(verdict: LiveVerdict): String {
        val failures = verdict.failures.joinToString(",") { "${it.fieldId}:${it.rule}" }
        return "${verdict.state}|$failures"
    }

    fun shouldSpeak(verdict: LiveVerdict, nowMs: Long): Boolean {
        val key = keyFor(verdict)
        if (key == lastKey && nowMs - lastMs < windowMs) return false
        lastKey = key
        lastMs = nowMs
        return true
    }
}
