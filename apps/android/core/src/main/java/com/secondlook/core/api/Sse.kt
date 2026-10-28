package com.secondlook.core.api

/**
 * Server-sent event framing: split a text buffer into `data:`
 * payloads. Multi-line data blocks join with newlines; comments,
 * blank lines, and other fields are ignored. Pure string logic so
 * it unit-tests without a network.
 */
fun parseSseData(buffer: String): List<String> {
    if (buffer.isBlank()) return emptyList()
    val payloads = ArrayList<String>()
    val current = ArrayList<String>()
    fun flush() {
        if (current.isNotEmpty()) {
            payloads.add(current.joinToString("\n"))
            current.clear()
        }
    }
    for (rawLine in buffer.split("\n")) {
        val line = rawLine.trimEnd('\r')
        if (line.isEmpty()) {
            flush()
            continue
        }
        if (line.startsWith(":")) continue
        if (line.startsWith("data:")) {
            var value = line.substring("data:".length)
            if (value.startsWith(" ")) value = value.substring(1)
            current.add(value)
        }
    }
    flush()
    return payloads
}
