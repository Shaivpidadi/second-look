package com.secondlook.core.speech

import com.secondlook.core.api.LiveVerdict
import com.secondlook.core.api.VerdictFailure
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SpeechTest {
    private fun verdict(
        state: String,
        failures: List<Pair<String, String>> = emptyList(),
    ): LiveVerdict {
        return LiveVerdict(
            id = "v-$state-${failures.hashCode()}",
            seq = 1,
            sessionId = "s",
            fieldId = "frame.pov",
            decision = if (state == "blocked") "BLOCK" else "ALLOW",
            state = state,
            failures = failures.map { (fieldId, rule) ->
                VerdictFailure(fieldId, rule, "m", null)
            },
            ts = "t",
        )
    }

    @Test
    fun `field mismatch names the field and document`() {
        assertEquals(
            "Container number does not match the bill of lading.",
            phraseFor(verdict("mismatch", listOf("bol.containerNumber" to "field_match"))),
        )
    }

    @Test
    fun `check digit and cross doc have their own phrases`() {
        assertEquals(
            "Air waybill number has a wrong check digit.",
            phraseFor(verdict("blocked", listOf("awb.awbNumber" to "check_digit"))),
        )
        assertEquals(
            "Invoice quantity differs between documents.",
            phraseFor(verdict("mismatch", listOf("invoice.totalQty" to "cross_doc"))),
        )
    }

    @Test
    fun `extra failures are counted, not spoken`() {
        assertEquals(
            "Container number does not match the bill of lading. Plus 2 more issues.",
            phraseFor(
                verdict(
                    "mismatch",
                    listOf(
                        "bol.containerNumber" to "field_match",
                        "awb.awbNumber" to "check_digit",
                        "label.sscc" to "check_digit",
                    ),
                ),
            ),
        )
        assertEquals(
            "S S C C has a wrong check digit. Plus 1 more issue.",
            phraseFor(
                verdict(
                    "blocked",
                    listOf("label.sscc" to "check_digit", "bol.cartons" to "cross_doc"),
                ),
            ),
        )
    }

    @Test
    fun `unknown fields and rules fall back gracefully`() {
        assertEquals(
            "Packing number does not match the packing list.",
            phraseFor(verdict("mismatch", listOf("packing.packingNumber" to "field_match"))),
        )
        assertEquals(
            "Carrier needs attention.",
            phraseFor(verdict("mismatch", listOf("bol.carrier" to "mystery_rule"))),
        )
    }

    @Test
    fun `only mismatch and blocked speak`() {
        val failure = listOf("bol.containerNumber" to "field_match")
        assertNull(phraseFor(verdict("clean")))
        assertNull(phraseFor(verdict("needs-human", failure)))
        assertNull(phraseFor(verdict("throttled")))
        assertNull(phraseFor(verdict("mismatch")))
        assertTrue(phraseFor(verdict("mismatch", failure)) != null)
        assertTrue(phraseFor(verdict("blocked", failure)) != null)
    }

    @Test
    fun `debounce suppresses repeats inside the window`() {
        val debounce = SpeakDebounce(windowMs = 30_000)
        val verdict = verdict("mismatch", listOf("bol.containerNumber" to "field_match"))
        assertTrue(debounce.shouldSpeak(verdict, 0))
        assertTrue(!debounce.shouldSpeak(verdict, 29_999))
        assertTrue(debounce.shouldSpeak(verdict, 30_000))
    }

    @Test
    fun `debounce also gates raw keys`() {
        val debounce = SpeakDebounce(windowMs = 30_000)
        assertTrue(debounce.shouldSpeakKey("failure:TIMEOUT", 0))
        assertTrue(!debounce.shouldSpeakKey("failure:TIMEOUT", 1))
        assertTrue(debounce.shouldSpeakKey("failure:TIMEOUT", 30_000))
    }

    @Test
    fun `debounce keys on state plus failures`() {
        val debounce = SpeakDebounce(windowMs = 30_000)
        val first = verdict("mismatch", listOf("bol.containerNumber" to "field_match"))
        val otherField = verdict("mismatch", listOf("awb.awbNumber" to "field_match"))
        val otherState = verdict("blocked", listOf("bol.containerNumber" to "field_match"))
        assertTrue(debounce.shouldSpeak(first, 0))
        assertTrue(debounce.shouldSpeak(otherField, 1))
        assertTrue(debounce.shouldSpeak(otherState, 2))
        assertTrue(!debounce.shouldSpeak(otherState, 3))
    }
}
