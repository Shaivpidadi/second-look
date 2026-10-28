package com.secondlook.core.session

/**
 * Client-side session memory: paper fields learned from frame POST
 * responses, sent back as a compact summary so any server instance
 * can run cross-doc checks. Same caps as the server (6 docs, 40
 * fields each, short values); oldest documents drop first.
 */
class SessionMemory(
    private val maxDocs: Int = 6,
    private val maxFields: Int = 40,
    private val maxValueLength: Int = 200,
) {
    private val docs = LinkedHashMap<String, LinkedHashMap<String, String>>()

    private fun validType(type: String): Boolean {
        if (type.isEmpty() || type.length > 24) return false
        return type.all { it.isLowerCase() || it.isDigit() || it == '-' }
    }

    /** Learn one judged document; junk is ignored, never stored. */
    fun learn(document: String?, readings: Map<String, String>?) {
        val type = document?.trim()?.lowercase() ?: return
        if (!validType(type) || readings.isNullOrEmpty()) return
        val fields = LinkedHashMap<String, String>()
        for ((field, value) in readings) {
            if (fields.size >= maxFields) break
            if (field.isEmpty() || value.isEmpty() || value.length > maxValueLength) continue
            val id = if (field.contains(".")) field else "$type.$field"
            fields[id] = value
        }
        if (fields.isEmpty()) return
        docs.remove(type)
        docs[type] = fields
        while (docs.size > maxDocs) {
            docs.keys.firstOrNull()?.let { docs.remove(it) }
        }
    }

    fun isEmpty(): Boolean = docs.isEmpty()

    /** Snapshot for the next frame POST. */
    fun snapshot(): Map<String, Map<String, String>> = docs.mapValues { it.value.toMap() }
}

/**
 * Capped set of verdict ids already rendered, so POST responses and
 * SSE never double-deliver. Oldest ids drop first past the cap.
 */
class SeenIds(private val maxSize: Int = 500) {
    private val ids = LinkedHashSet<String>()

    /** True when the id is new (and now recorded). */
    fun add(id: String): Boolean {
        if (!ids.add(id)) return false
        while (ids.size > maxSize) {
            val oldest = ids.iterator()
            if (!oldest.hasNext()) break
            oldest.next()
            oldest.remove()
        }
        return true
    }
}
