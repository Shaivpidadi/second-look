package com.secondlook.core.api

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Test

class JsonTest {
    @Test
    fun `parses nested objects and arrays`() {
        val decoded = parseJson("""{"a":1,"b":[true,null,"x"],"c":{"d":-2.5}}""")
        val map = decoded as Map<*, *>
        assertEquals(1.0, map["a"])
        assertEquals(listOf(true, null, "x"), map["b"])
        assertEquals(mapOf("d" to -2.5), map["c"])
    }

    @Test
    fun `parses string escapes`() {
        val decoded = parseJson("""{"q":"a\"b\\c\nd\té"}""") as Map<*, *>
        assertEquals("a\"b\\c\nd\té", decoded["q"])
    }

    @Test
    fun `rejects bad input`() {
        assertThrows(JsonException::class.java) { parseJson("{") }
        assertThrows(JsonException::class.java) { parseJson("""{"a":}""") }
        assertThrows(JsonException::class.java) { parseJson("[1,]") }
        assertThrows(JsonException::class.java) { parseJson("yes") }
        assertThrows(JsonException::class.java) { parseJson("{} trailing") }
    }

    @Test
    fun `parses empty containers and literals`() {
        assertEquals(emptyMap<String, Any?>(), parseJson("  {} "))
        assertEquals(emptyList<Any?>(), parseJson("[]"))
        assertEquals(true, parseJson("true"))
        assertNull(parseJson("null"))
    }

    @Test
    fun `encodes string literals with escapes`() {
        assertEquals("\"a\\\"b\\\\c\\n\"", jsonString("a\"b\\c\n"))
        assertEquals("\"plain\"", jsonString("plain"))
    }
}
