package com.secondlook.android.frames

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageFormat
import android.graphics.Rect
import android.graphics.YuvImage
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer

/**
 * YUV frame encoding for the stream path.
 *
 * The SDK documents uncompressed frames as decoded YUV pixel data
 * but does not pin the plane order; this encoder assumes NV21
 * (the Android camera default) and returns null on any failure
 * instead of crashing, so an unexpected layout degrades to a
 * dropped frame plus a log line. Compressed (HEVC) frames are
 * rejected: the client streams uncompressed on purpose.
 */
object YuvJpeg {
    fun encode(
        buffer: ByteBuffer,
        width: Int,
        height: Int,
        isCompressed: Boolean,
        quality: Int,
    ): ByteArray? {
        if (isCompressed || width <= 0 || height <= 0) return null
        return try {
            val bytes = ByteArray(buffer.remaining())
            buffer.duplicate().get(bytes)
            val expected = width * height * 3 / 2
            if (bytes.size < expected) return null
            val image = YuvImage(bytes, ImageFormat.NV21, width, height, null)
            val out = ByteArrayOutputStream(expected / 2)
            val ok = image.compressToJpeg(Rect(0, 0, width, height), quality, out)
            if (!ok) null else out.toByteArray()
        } catch (_: Exception) {
            null
        }
    }

    fun decode(jpeg: ByteArray): Bitmap? = try {
        BitmapFactory.decodeByteArray(jpeg, 0, jpeg.size)
    } catch (_: Exception) {
        null
    }
}
