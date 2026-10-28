package com.secondlook.core.session

import com.secondlook.core.api.ApiException
import java.net.ConnectException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class FailuresTest {
    @Test
    fun `timeouts and unreachable hosts map with retry`() {
        val timeout = networkFailure(SocketTimeoutException("read timed out"))
        assertEquals(FailureKind.TIMEOUT, timeout.kind)
        assertEquals("Server timed out.", timeout.spokenLine)
        assertTrue(timeout.autoRetry)

        val dns = networkFailure(UnknownHostException("nope"))
        assertEquals(FailureKind.SERVER_UNREACHABLE, dns.kind)
        assertTrue(dns.detail.contains("base URL"))
        assertTrue(dns.autoRetry)

        val refused = networkFailure(ConnectException("refused"))
        assertEquals(FailureKind.SERVER_UNREACHABLE, refused.kind)
    }

    @Test
    fun `http 4xx stays silent without retry, 5xx retries aloud`() {
        val bad = networkFailure(ApiException("POST /api/events failed with status 422"))
        assertEquals(FailureKind.SERVER_ERROR, bad.kind)
        assertNull(bad.spokenLine)
        assertFalse(bad.autoRetry)

        val down = networkFailure(ApiException("POST /api/events failed with status 502"))
        assertEquals(FailureKind.SERVER_ERROR, down.kind)
        assertEquals("Server error.", down.spokenLine)
        assertTrue(down.autoRetry)
    }

    @Test
    fun `unknown throwables retry as server errors`() {
        val state = networkFailure(RuntimeException("boom"))
        assertEquals(FailureKind.SERVER_ERROR, state.kind)
        assertTrue(state.detail.contains("boom"))
        assertTrue(state.autoRetry)
    }

    @Test
    fun `glasses, permission, phone, and quality factories`() {
        assertEquals(FailureKind.GLASSES_LINK, glassesFailure("x").kind)
        assertEquals("Glasses disconnected.", glassesFailure("x").spokenLine)
        assertFalse(glassesFailure("x").autoRetry)

        val dat = permissionFailure(phone = false)
        assertEquals(FailureKind.CAMERA_PERMISSION, dat.kind)
        assertTrue(dat.detail.contains("Meta AI app"))
        assertTrue(dat.spokenLine!!.contains("Meta A I app"))

        val phone = permissionFailure(phone = true)
        assertTrue(phone.detail.contains("Phone camera"))

        assertEquals(FailureKind.PHONE_CAMERA, phoneCameraFailure("x").kind)
        assertNull(phoneCameraFailure("x", null).spokenLine)

        val low = lowQuality()
        assertEquals(FailureKind.LOW_QUALITY, low.kind)
        assertEquals("Hold still.", low.spokenLine)
        assertTrue(low.autoRetry)
    }

    @Test
    fun `retry policy backs off and caps`() {
        val policy = RetryPolicy()
        assertEquals(1000L, policy.delayForAttempt(0))
        assertEquals(2000L, policy.delayForAttempt(1))
        assertEquals(4000L, policy.delayForAttempt(2))
        assertEquals(8000L, policy.delayForAttempt(3))
        assertEquals(8000L, policy.delayForAttempt(9))
        assertTrue(policy.shouldRetry(lowQuality(), 0))
        assertTrue(policy.shouldRetry(lowQuality(), 3))
        assertFalse(policy.shouldRetry(lowQuality(), 4))
        assertFalse(policy.shouldRetry(glassesFailure("x"), 0))
    }
}
