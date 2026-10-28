package com.secondlook.core.session

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SessionMemoryTest {
    @Test
    fun `learns and snapshots documents`() {
        val memory = SessionMemory()
        assertTrue(memory.isEmpty())
        memory.learn("bol", mapOf("bol.weightKg" to "1000", "weightKg2" to "x"))
        memory.learn("awb", mapOf("awb.weightKg" to "2000"))
        assertFalse(memory.isEmpty())
        assertEquals(
            mapOf(
                "bol" to mapOf("bol.weightKg" to "1000", "bol.weightKg2" to "x"),
                "awb" to mapOf("awb.weightKg" to "2000"),
            ),
            memory.snapshot(),
        )
    }

    @Test
    fun `relearning refreshes and overwrites`() {
        val memory = SessionMemory(maxDocs = 2)
        memory.learn("bol", mapOf("a" to "1"))
        memory.learn("awb", mapOf("b" to "2"))
        memory.learn("bol", mapOf("a" to "3"))
        assertEquals(mapOf("bol.a" to "3"), memory.snapshot()["bol"])
        memory.learn("pod", mapOf("c" to "4"))
        // bol was refreshed, so awb (oldest) drops.
        assertEquals(setOf("bol", "pod"), memory.snapshot().keys)
    }

    @Test
    fun `caps fields and drops junk`() {
        val memory = SessionMemory(maxFields = 2, maxValueLength = 4)
        memory.learn(null, mapOf("a" to "b"))
        memory.learn("BOL!!!", mapOf("a" to "b"))
        memory.learn("bol", null)
        memory.learn("bol", emptyMap())
        assertTrue(memory.isEmpty())
        memory.learn("bol", mapOf("a" to "toolongvalue", "" to "x", "ok" to "fine"))
        assertEquals(mapOf("bol.ok" to "fine"), memory.snapshot()["bol"])
        memory.learn("awb", mapOf("a" to "1", "b" to "2", "c" to "3"))
        assertEquals(2, memory.snapshot()["awb"]?.size)
    }
}

class SeenIdsTest {
    @Test
    fun `first add wins, repeats lose`() {
        val seen = SeenIds()
        assertTrue(seen.add("a"))
        assertFalse(seen.add("a"))
        assertTrue(seen.add("b"))
    }

    @Test
    fun `oldest ids drop past the cap`() {
        val seen = SeenIds(maxSize = 2)
        assertTrue(seen.add("a"))
        assertTrue(seen.add("b"))
        assertTrue(seen.add("c"))
        assertTrue(seen.add("a"))
        assertFalse(seen.add("a"))
        assertTrue(seen.add("b"))
    }
}
