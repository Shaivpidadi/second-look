package com.secondlook.core.api

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class FrameResultTest {
    private fun response(extra: String = ""): Map<String, Any?> {
        @Suppress("UNCHECKED_CAST")
        return parseJson(
            """{"ok":true,"frame":"judged","memoryAccepted":true,
               |"document":"bol","readings":{"bol.weightKg":"1000"},
               |"verdicts":[{"id":"v1","seq":1,"sessionId":"s","fieldId":"frame.pov",
               |"decision":"ALLOW","state":"clean","failures":[],"ts":"t"}$extra]}""".trimMargin(),
        ) as Map<String, Any?>
    }

    @Test
    fun `parses a judged response`() {
        val result = parseFramePostResponse(response())!!
        assertEquals("judged", result.frame)
        assertEquals(1, result.verdicts.size)
        assertEquals("v1", result.verdicts[0].id)
        assertEquals("bol", result.document)
        assertEquals(mapOf("bol.weightKg" to "1000"), result.readings)
        assertTrue(result.memoryAccepted)
    }

    @Test
    fun `malformed verdict entries are skipped`() {
        val result = parseFramePostResponse(
            response(
                """,{"id":"bad","seq":"x","sessionId":"s","fieldId":"f",
                   |"decision":"ALLOW","state":"clean","failures":[],"ts":"t"}""".trimMargin(),
            ),
        )!!
        assertEquals(1, result.verdicts.size)
        assertEquals("v1", result.verdicts[0].id)
    }

    @Test
    fun `duplicate responses carry no verdicts`() {
        @Suppress("UNCHECKED_CAST")
        val decoded = parseJson("""{"ok":true,"frame":"duplicate","verdicts":[]}""") as Map<String, Any?>
        val result = parseFramePostResponse(decoded)!!
        assertEquals("duplicate", result.frame)
        assertTrue(result.verdicts.isEmpty())
        assertNull(result.document)
        assertTrue(result.readings.isEmpty())
    }

    @Test
    fun `failures and non-objects parse to null`() {
        @Suppress("UNCHECKED_CAST")
        val failed = parseJson("""{"ok":false,"error":"frame_judge_failed"}""") as Map<String, Any?>
        assertNull(parseFramePostResponse(failed))
        @Suppress("UNCHECKED_CAST")
        val missing = parseJson("""{"ok":true}""") as Map<String, Any?>
        assertNull(parseFramePostResponse(missing))
    }
}
