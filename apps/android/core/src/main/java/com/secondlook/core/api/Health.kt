package com.secondlook.core.api

/**
 * Demo-day preflight probe (see apps/web/app/api/health/route.ts).
 * The server reports the key as present or missing, never the value.
 */
data class ApiHealth(
    val ok: Boolean,
    val mode: String,
    val keyPresent: Boolean,
)

/** Parse a health payload; lenient defaults keep preflight total. */
fun parseApiHealth(payload: Map<String, Any?>): ApiHealth {
    return ApiHealth(
        ok = payload["ok"] == true,
        mode = payload["mode"] as? String ?: "stub",
        keyPresent = payload["keyPresent"] == true,
    )
}
