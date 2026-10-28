package com.secondlook.core.frames

import com.secondlook.core.session.FailureKind

/** Frame origin: Ray-Ban Meta DAT stream or the phone CameraX fallback. */
enum class CameraSource {
    GLASSES,
    PHONE,
}

/**
 * One-tap source change: the target plus whether the live stream must
 * restart (stop + start on the same session, keeping verdicts, memory,
 * and speech settings).
 */
data class SourceSwitch(
    val from: CameraSource,
    val to: CameraSource,
    val restartStream: Boolean,
)

/** Flip to the other source; a live stream restarts on it. */
fun planToggle(from: CameraSource, streaming: Boolean): SourceSwitch {
    val to = if (from == CameraSource.GLASSES) CameraSource.PHONE else CameraSource.GLASSES
    return SourceSwitch(from, to, streaming)
}

/** Drop to the phone camera; null when already on it (nothing to do). */
fun planFallbackToPhone(from: CameraSource, streaming: Boolean): SourceSwitch? {
    if (from == CameraSource.PHONE) return null
    return SourceSwitch(from, CameraSource.PHONE, streaming)
}

/**
 * Offer the one-tap phone fallback only for failures the phone route
 * actually escapes: a dead glasses link or glasses camera permission,
 * while still on the glasses source.
 */
fun phoneFallbackOffered(kind: FailureKind, source: CameraSource): Boolean {
    if (source != CameraSource.GLASSES) return false
    return kind == FailureKind.GLASSES_LINK || kind == FailureKind.CAMERA_PERMISSION
}
