package com.secondlook.core.frames

import com.secondlook.core.session.FailureKind
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class CameraSourceTest {
    @Test
    fun toggleWhileStoppedFlipsWithoutRestart() {
        assertEquals(
            SourceSwitch(CameraSource.GLASSES, CameraSource.PHONE, false),
            planToggle(CameraSource.GLASSES, streaming = false),
        )
        assertEquals(
            SourceSwitch(CameraSource.PHONE, CameraSource.GLASSES, false),
            planToggle(CameraSource.PHONE, streaming = false),
        )
    }

    @Test
    fun toggleWhileStreamingRestartsOnNewSource() {
        assertEquals(
            SourceSwitch(CameraSource.GLASSES, CameraSource.PHONE, true),
            planToggle(CameraSource.GLASSES, streaming = true),
        )
    }

    @Test
    fun fallbackPlansPhoneWithMatchingRestart() {
        assertEquals(
            SourceSwitch(CameraSource.GLASSES, CameraSource.PHONE, true),
            planFallbackToPhone(CameraSource.GLASSES, streaming = true),
        )
        assertEquals(
            SourceSwitch(CameraSource.GLASSES, CameraSource.PHONE, false),
            planFallbackToPhone(CameraSource.GLASSES, streaming = false),
        )
    }

    @Test
    fun fallbackIsNoopOnPhone() {
        assertNull(planFallbackToPhone(CameraSource.PHONE, streaming = true))
        assertNull(planFallbackToPhone(CameraSource.PHONE, streaming = false))
    }

    @Test
    fun fallbackOfferedOnlyForGlassesFailuresOnGlasses() {
        assertTrue(phoneFallbackOffered(FailureKind.GLASSES_LINK, CameraSource.GLASSES))
        assertTrue(phoneFallbackOffered(FailureKind.CAMERA_PERMISSION, CameraSource.GLASSES))
        assertFalse(phoneFallbackOffered(FailureKind.GLASSES_LINK, CameraSource.PHONE))
        assertFalse(phoneFallbackOffered(FailureKind.CAMERA_PERMISSION, CameraSource.PHONE))
        for (kind in listOf(
            FailureKind.PHONE_CAMERA,
            FailureKind.SERVER_UNREACHABLE,
            FailureKind.TIMEOUT,
            FailureKind.SERVER_ERROR,
            FailureKind.LOW_QUALITY,
        )) {
            assertFalse(phoneFallbackOffered(kind, CameraSource.GLASSES))
            assertFalse(phoneFallbackOffered(kind, CameraSource.PHONE))
        }
    }
}
