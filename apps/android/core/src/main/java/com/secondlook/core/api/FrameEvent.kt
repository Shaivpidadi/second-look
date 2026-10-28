package com.secondlook.core.api

import java.util.Base64

/**
 * One glasses frame posted to the existing `POST /api/events` route,
 * the same endpoint the receiving form posts keystrokes to. The JPEG
 * rides as a data URL in the event value, plus a compact summary of
 * the session memory (extracted fields, no image bytes) so any server
 * instance can run cross-doc checks; the server validates, dedupes,
 * and judges it through the vision path, and verdicts come back in
 * the POST response as well as over the SSE stream.
 */
data class FrameEvent(
    val sessionId: String,
    val tsIso: String,
    val jpeg: ByteArray,
    val memory: Map<String, Map<String, String>> = emptyMap(),
) {
    companion object {
        const val FIELD_ID = "frame.pov"
    }

    /** Request body for `POST /api/events`. */
    fun toJson(): String {
        val base64 = "data:image/jpeg;base64," + Base64.getEncoder().encodeToString(jpeg)
        val docs = memory.entries.joinToString(",") { (type, fields) ->
            val pairs = fields.entries.joinToString(",") { (field, value) ->
                "${jsonString(field)}:${jsonString(value)}"
            }
            "${jsonString(type)}:{$pairs}"
        }
        return "{\"sessionId\":${jsonString(sessionId)}," +
            "\"fieldId\":${jsonString(FIELD_ID)}," +
            "\"value\":${jsonString(base64)}," +
            "\"ts\":${jsonString(tsIso)}," +
            "\"memory\":{$docs}}"
    }

    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (other !is FrameEvent) return false
        return sessionId == other.sessionId && tsIso == other.tsIso && jpeg.contentEquals(other.jpeg)
    }

    override fun hashCode(): Int {
        var result = sessionId.hashCode()
        result = 31 * result + tsIso.hashCode()
        result = 31 * result + jpeg.contentHashCode()
        return result
    }
}
