package com.secondlook.core.session

import com.secondlook.core.api.ApiException
import java.net.ConnectException
import java.net.NoRouteToHostException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import javax.net.ssl.SSLException

/**
 * Demo-day failure states. Each carries an on-screen line, an optional
 * spoken line, and whether the app retries on its own.
 */
enum class FailureKind {
    GLASSES_LINK,
    CAMERA_PERMISSION,
    PHONE_CAMERA,
    SERVER_UNREACHABLE,
    TIMEOUT,
    SERVER_ERROR,
    LOW_QUALITY,
}

data class FailureState(
    val kind: FailureKind,
    val detail: String,
    val spokenLine: String?,
    val autoRetry: Boolean,
)

/**
 * Classify an upload/stream exception. Transport problems name the
 * base URL; HTTP 4xx (our frame was malformed) stays silent and does
 * not retry; everything else speaks once and retries with backoff.
 */
fun networkFailure(error: Throwable): FailureState {
    if (error is SocketTimeoutException) {
        return FailureState(FailureKind.TIMEOUT, "Server timed out. Retrying.", "Server timed out.", true)
    }
    if (
        error is UnknownHostException || error is ConnectException ||
        error is NoRouteToHostException || error is SSLException
    ) {
        return FailureState(
            FailureKind.SERVER_UNREACHABLE,
            "Server unreachable. Check the base URL.",
            "Server unreachable.",
            true,
        )
    }
    if (error is ApiException) {
        val status = Regex("status (\\d{3})").find(error.message ?: "")
            ?.groupValues?.get(1)?.toIntOrNull()
        if (status != null && status in 400..499) {
            return FailureState(
                FailureKind.SERVER_ERROR,
                "Server rejected the request (HTTP $status).",
                null,
                false,
            )
        }
        val suffix = status?.let { " (HTTP $it)" } ?: ""
        return FailureState(FailureKind.SERVER_ERROR, "Server error$suffix. Retrying.", "Server error.", true)
    }
    val reason = error.message ?: "unknown error"
    return FailureState(FailureKind.SERVER_ERROR, "Upload failed: $reason. Retrying.", "Server error.", true)
}

/** Glasses link failure (registration, session, camera, stream). Manual recovery. */
fun glassesFailure(detail: String, spokenLine: String? = "Glasses disconnected."): FailureState {
    return FailureState(FailureKind.GLASSES_LINK, detail, spokenLine, false)
}

/** Camera permission denied: DAT glasses (Meta AI app) or the phone camera. */
fun permissionFailure(phone: Boolean): FailureState {
    return if (phone) {
        FailureState(
            FailureKind.CAMERA_PERMISSION,
            "Phone camera permission denied. Grant it and tap Start.",
            "Camera permission denied.",
            false,
        )
    } else {
        FailureState(
            FailureKind.CAMERA_PERMISSION,
            "Camera permission denied. Enable camera in the Meta AI app, then tap Start.",
            "Camera permission denied. Enable it in the Meta A I app.",
            false,
        )
    }
}

/** Phone-camera source failure. Manual recovery via Stop/Start. */
fun phoneCameraFailure(detail: String, spokenLine: String? = "Phone camera failed."): FailureState {
    return FailureState(FailureKind.PHONE_CAMERA, detail, spokenLine, false)
}

/** Blurry or document-less frame, via the abstention gate. Self-heals. */
fun lowQuality(): FailureState {
    return FailureState(FailureKind.LOW_QUALITY, "Low frame quality. Hold still.", "Hold still.", true)
}

/** Capped exponential backoff for retried failures. */
class RetryPolicy(
    val maxAttempts: Int = 4,
    val baseDelayMs: Long = 1000,
    val maxDelayMs: Long = 8000,
) {
    /** Delay before retry `attempt` (0-based): 1s, 2s, 4s, 8s, capped. */
    fun delayForAttempt(attempt: Int): Long {
        var delay = baseDelayMs
        repeat(attempt.coerceAtLeast(0)) {
            delay = (delay * 2).coerceAtMost(maxDelayMs)
        }
        return delay
    }

    fun shouldRetry(state: FailureState, attempt: Int): Boolean {
        return state.autoRetry && attempt < maxAttempts
    }
}
