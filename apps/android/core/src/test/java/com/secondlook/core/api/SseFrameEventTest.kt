package com.secondlook.core.api

import java.util.Base64
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class SseFrameEventTest {
    @Test
    fun `splits data blocks and skips comments`() {
        val buffer = ": hello\n\ndata: {\"a\":1}\n\ndata: one\ndata: two\n\n"
        assertEquals(listOf("{\"a\":1}", "one\ntwo"), parseSseData(buffer))
    }

    @Test
    fun `tolerates CRLF and trailing unterminated block`() {
        assertEquals(listOf("x"), parseSseData("data: x\r\n\r\n"))
        assertEquals(listOf("x"), parseSseData("data: x"))
        assertEquals(emptyList<String>(), parseSseData("  \n"))
    }

    @Test
    fun `frame event posts to the form pipeline shape`() {
        val jpeg = byteArrayOf(1, 2, 3, 4)
        val event = FrameEvent("s1", "2026-10-28T00:00:00.000Z", jpeg)
        assertEquals("frame.pov", FrameEvent.FIELD_ID)
        @Suppress("UNCHECKED_CAST")
        val decoded = parseJson(event.toJson()) as Map<String, Any?>
        assertEquals("s1", decoded["sessionId"])
        assertEquals("frame.pov", decoded["fieldId"])
        assertEquals("2026-10-28T00:00:00.000Z", decoded["ts"])
        val roundTrip = Base64.getDecoder().decode(decoded["value"] as String)
        assertTrue(roundTrip.contentEquals(jpeg))
    }

    @Test
    fun `api builds the existing route urls`() {
        val api = SecondLookApi("https://second-look.example")
        assertEquals("https://second-look.example/api/events", api.eventsUrl())
        assertEquals(
            "https://second-look.example/api/verdicts?sessionId=abc",
            api.verdictsUrl("abc"),
        )
    }
}
