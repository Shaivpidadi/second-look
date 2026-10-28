package com.secondlook.core.api

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class HealthTest {
    @Test
    fun `parses the health probe`() {
        @Suppress("UNCHECKED_CAST")
        val decoded = parseJson("""{"ok":true,"mode":"real","keyPresent":true}""") as Map<String, Any?>
        val health = parseApiHealth(decoded)
        assertTrue(health.ok)
        assertEquals("real", health.mode)
        assertTrue(health.keyPresent)
    }

    @Test
    fun `missing keys default safe`() {
        val health = parseApiHealth(emptyMap())
        assertFalse(health.ok)
        assertEquals("stub", health.mode)
        assertFalse(health.keyPresent)
    }
}
