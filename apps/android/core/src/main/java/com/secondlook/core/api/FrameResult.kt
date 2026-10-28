package com.secondlook.core.api

/**
 * What one frame POST returned: every verdict that frame produced
 * (frame verdict plus any cross-doc verdict), the judged document
 * and readings for session memory, and whether the server accepted
 * the memory summary the client sent.
 */
data class FramePostResult(
    /** judged, duplicate, or throttled. */
    val frame: String,
    val verdicts: List<LiveVerdict>,
    val document: String?,
    val readings: Map<String, String>,
    val memoryAccepted: Boolean,
)

/**
 * Parse a frame POST response body into [FramePostResult]. Malformed
 * verdict entries are skipped, not fatal; null only when the whole
 * body is unusable.
 */
fun parseFramePostResponse(payload: Map<String, Any?>): FramePostResult? {
    if (payload["ok"] != true) return null
    val frame = payload["frame"] as? String ?: return null
    val rawVerdicts = payload["verdicts"] as? List<*> ?: emptyList<Any>()
    val verdicts = rawVerdictToList(rawVerdicts)
    val readings = (payload["readings"] as? Map<*, *>)
        ?.entries
        ?.mapNotNull { (key, value) ->
            if (key is String && value is String) key to value else null
        }
        ?.toMap() ?: emptyMap()
    return FramePostResult(
        frame = frame,
        verdicts = verdicts,
        document = payload["document"] as? String,
        readings = readings,
        memoryAccepted = payload["memoryAccepted"] as? Boolean ?: true,
    )
}

private fun rawVerdictToList(raw: List<*>): List<LiveVerdict> {
    return raw.mapNotNull { item ->
        @Suppress("UNCHECKED_CAST")
        val map = item as? Map<String, Any?> ?: return@mapNotNull null
        try {
            parseVerdict(map)
        } catch (_: IllegalArgumentException) {
            null
        }
    }
}
