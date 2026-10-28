package com.secondlook.core.api

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class VerdictTest {
    private fun payload(extra: String = ""): Map<String, Any?> {
        @Suppress("UNCHECKED_CAST")
        return parseJson(
            """{"seq":3,"sessionId":"s1","fieldId":"awb.awbNumber","decision":"BLOCK","state":"blocked",
               |"failures":[{"fieldId":"awb.awbNumber","rule":"awb_check_digit","message":"bad digit","fix":"02027342206"}$extra],
               |"ts":"2026-10-28T00:00:00.000Z"}""".trimMargin(),
        ) as Map<String, Any?>
    }

    @Test
    fun `parses a published verdict`() {
        val verdict = parseVerdict(payload())!!
        assertEquals(3, verdict.seq)
        assertEquals("s1", verdict.sessionId)
        assertEquals("awb.awbNumber", verdict.fieldId)
        assertEquals("BLOCK", verdict.decision)
        assertEquals("blocked", verdict.state)
        assertEquals(1, verdict.failures.size)
        assertEquals("02027342206", verdict.failures[0].fix)
    }

    @Test
    fun `hello payloads parse to null`() {
        @Suppress("UNCHECKED_CAST")
        val hello = parseJson("""{"hello":"s1"}""") as Map<String, Any?>
        assertNull(parseVerdict(hello))
    }

    @Test
    fun `fix is optional`() {
        @Suppress("UNCHECKED_CAST")
        val decoded = parseJson(
            """{"seq":1,"sessionId":"s","fieldId":"f","decision":"ALLOW","state":"clean",
               |"failures":[{"fieldId":"f","rule":"r","message":"m"}],"ts":"t"}""".trimMargin(),
        ) as Map<String, Any?>
        assertNull(parseVerdict(decoded)!!.failures[0].fix)
    }

    @Test
    fun `labels match the web vocabulary`() {
        assertEquals("Pass", verdictLabel("clean"))
        assertEquals("Warn", verdictLabel("mismatch"))
        assertEquals("Blocked", verdictLabel("blocked"))
        assertEquals("Needs human", verdictLabel("needs-human"))
    }
}
