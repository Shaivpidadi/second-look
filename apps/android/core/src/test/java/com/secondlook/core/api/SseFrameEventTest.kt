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
        val value = decoded["value"] as String
        assertTrue(value.startsWith("data:image/jpeg;base64,"))
        val roundTrip = Base64.getDecoder().decode(value.substringAfter(","))
        assertTrue(roundTrip.contentEquals(jpeg))
        @Suppress("UNCHECKED_CAST")
        assertEquals(emptyMap<String, Any?>(), decoded["memory"] as Map<String, Any?>)
        val withMemory = FrameEvent("s1", "t", jpeg, mapOf("bol" to mapOf("bol.weightKg" to "1")))
        @Suppress("UNCHECKED_CAST")
        val memDecoded = parseJson(withMemory.toJson()) as Map<String, Any?>
        @Suppress("UNCHECKED_CAST")
        val mem = memDecoded["memory"] as Map<String, Any?>
        @Suppress("UNCHECKED_CAST")
        assertEquals(mapOf("bol.weightKg" to "1"), mem["bol"] as Map<String, Any?>)
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
