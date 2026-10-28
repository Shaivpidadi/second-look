package com.secondlook.core.api

/**
 * Minimal JSON reader for the small shapes this client consumes
 * (verdict events). Supports objects, arrays, strings with escapes,
 * numbers, booleans, and null. Throws [JsonException] on bad input.
 */
class JsonException(message: String) : IllegalArgumentException(message)

private class Reader(private val text: String) {
    var pos = 0

    fun readValue(): Any? {
        skipGap()
        if (pos >= text.length) throw JsonException("unexpected end of input")
        return when (val c = text[pos]) {
            '{' -> readObject()
            '[' -> readArray()
            '"' -> readString()
            't' -> readLiteral("true", true)
            'f' -> readLiteral("false", false)
            'n' -> readLiteral("null", null)
            '-', in '0'..'9' -> readNumber()
            else -> throw JsonException("unexpected character '$c' at $pos")
        }
    }

    private fun skipGap() {
        while (pos < text.length && text[pos].isWhitespace()) pos++
    }

    private fun expect(c: Char) {
        skipGap()
        if (pos >= text.length || text[pos] != c) {
            throw JsonException("expected '$c' at $pos")
        }
        pos++
    }

    private fun readObject(): Map<String, Any?> {
        val out = LinkedHashMap<String, Any?>()
        pos++ // {
        skipGap()
        if (pos < text.length && text[pos] == '}') {
            pos++
            return out
        }
        while (true) {
            skipGap()
            if (pos >= text.length || text[pos] != '"') {
                throw JsonException("expected string key at $pos")
            }
            val key = readString()
            expect(':')
            out[key] = readValue()
            skipGap()
            if (pos >= text.length) throw JsonException("unterminated object")
            if (text[pos] == '}') {
                pos++
                return out
            }
            expect(',')
        }
    }

    private fun readArray(): List<Any?> {
        val out = ArrayList<Any?>()
        pos++ // [
        skipGap()
        if (pos < text.length && text[pos] == ']') {
            pos++
            return out
        }
        while (true) {
            out.add(readValue())
            skipGap()
            if (pos >= text.length) throw JsonException("unterminated array")
            if (text[pos] == ']') {
                pos++
                return out
            }
            expect(',')
        }
    }

    private fun readString(): String {
        pos++ // opening quote
        val out = StringBuilder()
        while (true) {
            if (pos >= text.length) throw JsonException("unterminated string")
            val c = text[pos++]
            if (c == '"') return out.toString()
            if (c != '\\') {
                out.append(c)
                continue
            }
            if (pos >= text.length) throw JsonException("unterminated escape")
            when (val e = text[pos++]) {
                '"', '\\', '/' -> out.append(e)
                'b' -> out.append('\b')
                'f' -> out.append('')
                'n' -> out.append('\n')
                'r' -> out.append('\r')
                't' -> out.append('\t')
                'u' -> {
                    if (pos + 4 > text.length) throw JsonException("bad unicode escape")
                    val hex = text.substring(pos, pos + 4)
                    val code = hex.toIntOrNull(16) ?: throw JsonException("bad unicode escape")
                    out.append(code.toChar())
                    pos += 4
                }
                else -> throw JsonException("bad escape '\\$e'")
            }
        }
    }

    private fun readLiteral(word: String, value: Any?): Any? {
        if (!text.startsWith(word, pos)) throw JsonException("unexpected token at $pos")
        pos += word.length
        return value
    }

    private fun readNumber(): Double {
        val start = pos
        while (pos < text.length && text[pos] in "-+0123456789.eE") pos++
        return text.substring(start, pos).toDoubleOrNull()
            ?: throw JsonException("bad number at $start")
    }

    fun end() {
        skipGap()
        if (pos != text.length) throw JsonException("trailing input at $pos")
    }
}

/** Parse a JSON document into maps, lists, strings, doubles, booleans, null. */
fun parseJson(text: String): Any? {
    val reader = Reader(text)
    val value = reader.readValue()
    reader.end()
    return value
}

/** Encode a string as a JSON string literal (quotes included). */
fun jsonString(value: String): String {
    val out = StringBuilder("\"")
    for (c in value) {
        when (c) {
            '"' -> out.append("\\\"")
            '\\' -> out.append("\\\\")
            '\n' -> out.append("\\n")
            '\r' -> out.append("\\r")
            '\t' -> out.append("\\t")
            else -> if (c < ' ') out.append("\\u%04x".format(c.code)) else out.append(c)
        }
    }
    return out.append('"').toString()
}
