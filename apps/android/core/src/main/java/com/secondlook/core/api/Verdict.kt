package com.secondlook.core.api

/** One field failure inside a live verdict (mirrors the web shape). */
data class VerdictFailure(
    val fieldId: String,
    val rule: String,
    val message: String,
    val fix: String?,
)

/**
 * A live verdict published by the server over SSE
 * (see apps/web/lib/verdict-bus.ts PublishedVerdict).
 */
data class LiveVerdict(
    val seq: Int,
    val sessionId: String,
    val fieldId: String,
    val decision: String,
    val state: String,
    val failures: List<VerdictFailure>,
    val ts: String,
)

/**
 * Display word for a verdict state. This is the same vocabulary the
 * web UI uses: Pass, Warn, Blocked, Needs human.
 */
fun verdictLabel(state: String): String = when (state) {
    "clean" -> "Pass"
    "mismatch" -> "Warn"
    "blocked" -> "Blocked"
    "needs-human" -> "Needs human"
    else -> state.replaceFirstChar { it.uppercase() }
}

/** Parse a decoded SSE `data:` payload into a verdict (or null for hello). */
fun parseVerdict(payload: Map<String, Any?>): LiveVerdict? {
    if (!payload.containsKey("seq")) return null // hello / keep-alive
    fun string(key: String): String {
        val value = payload[key] as? String
        requireNotNull(value) { "verdict is missing string '$key'" }
        return value
    }
    val seq = (payload["seq"] as? Double)?.toInt()
    requireNotNull(seq) { "verdict is missing numeric 'seq'" }
    val rawFailures = payload["failures"] as? List<*> ?: emptyList<Any>()
    val failures = rawFailures.map { item ->
        val map = item as? Map<*, *>
        requireNotNull(map) { "verdict failure is not an object" }
        VerdictFailure(
            fieldId = map["fieldId"] as? String ?: "",
            rule = map["rule"] as? String ?: "",
            message = map["message"] as? String ?: "",
            fix = map["fix"] as? String,
        )
    }
    return LiveVerdict(
        seq = seq,
        sessionId = string("sessionId"),
        fieldId = string("fieldId"),
        decision = string("decision"),
        state = string("state"),
        failures = failures,
        ts = string("ts"),
    )
}
