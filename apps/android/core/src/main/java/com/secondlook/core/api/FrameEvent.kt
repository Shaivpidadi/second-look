package com.secondlook.core.api

import java.util.Base64

/**
 * One glasses frame posted to the existing `POST /api/events` route,
 * the same endpoint the receiving form posts keystrokes to. The
 * server gate ignores unknown fields, so the JPEG rides the event
 * channel untouched and verdicts come back over the same SSE
 * stream; decoding frames for vision on the server is the
 * documented next step.
 */
data class FrameEvent(
    val sessionId: String,
    val tsIso: String,
    val jpeg: ByteArray,
) {
    companion object {
        const val FIELD_ID = "frame.pov"
    }

    /** Request body for `POST /api/events`. */
    fun toJson(): String {
        val base64 = Base64.getEncoder().encodeToString(jpeg)
        return "{\"sessionId\":${jsonString(sessionId)}," +
            "\"fieldId\":${jsonString(FIELD_ID)}," +
            "\"value\":${jsonString(base64)}," +
            "\"ts\":${jsonString(tsIso)}}"
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
