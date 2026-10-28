package com.secondlook.android.session

/** One Check-setup row: pass/fail plus a fix hint. */
data class PreflightItem(
    val label: String,
    val pass: Boolean,
    val hint: String,
)

/** Full setup report; allPass gates nothing, it just reads clearly. */
data class PreflightReport(
    val items: List<PreflightItem>,
    val ranAtIso: String,
) {
    val allPass: Boolean
        get() = items.all { it.pass }
}
