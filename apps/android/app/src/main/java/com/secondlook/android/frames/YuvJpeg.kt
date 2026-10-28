package com.secondlook.android.frames

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageFormat
import android.graphics.Rect
import android.graphics.YuvImage
import android.util.Log
import com.secondlook.core.frames.PackedOrder
import com.secondlook.core.frames.detectPackedOrder
import com.secondlook.core.frames.toNv21Packed
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer

private const val TAG = "YuvJpeg"

/**
 * YUV frame encoding for the stream path.
 *
 * The SDK documents uncompressed frames as decoded YUV pixel data
 * but pins no plane order, so packed buffers are classified by size
 * plus a chroma-structure heuristic (see core Yuv420) instead of
 * assuming NV21. Anything unparseable degrades to a dropped frame
 * plus a log line, never a crash. Compressed (HEVC) frames are
 * rejected: the client streams uncompressed on purpose.
 */
object YuvJpeg {
    fun encode(
        buffer: ByteBuffer,
        width: Int,
        height: Int,
        isCompressed: Boolean,
        quality: Int,
        chromaSwapped: Boolean = false,
    ): ByteArray? {
        if (isCompressed || width <= 0 || height <= 0) return null
        return try {
            val bytes = ByteArray(buffer.remaining())
            buffer.duplicate().get(bytes)
            val order = detectPackedOrder(bytes, width, height)
            if (order == null) {
                Log.w(TAG, "dropping frame: ${bytes.size} bytes is not packed YUV420 for ${width}x$height")
                return null
            }
            val effective = if (chromaSwapped) order.swapped() else order
            val nv21 = toNv21Packed(bytes, width, height, effective)
            if (nv21 == null) {
                Log.w(TAG, "dropping frame: cannot repack $effective for ${width}x$height")
                return null
            }
            encodeNv21(nv21, width, height, quality)
        } catch (e: Exception) {
            Log.w(TAG, "dropping frame: encode failed", e)
            null
        }
    }

    /** Classify one packed buffer for logging; null when unparseable. */
    fun detect(buffer: ByteBuffer, width: Int, height: Int): PackedOrder? {
        return try {
            val bytes = ByteArray(buffer.remaining())
            buffer.duplicate().get(bytes)
            detectPackedOrder(bytes, width, height)
        } catch (_: Exception) {
            null
        }
    }

    /** Compress packed NV21 bytes to JPEG; null on any failure. */
    fun encodeNv21(nv21: ByteArray, width: Int, height: Int, quality: Int): ByteArray? {
        return try {
            val image = YuvImage(nv21, ImageFormat.NV21, width, height, null)
            val out = ByteArrayOutputStream(nv21.size / 2)
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

    /** Manual override for the undetectable V-first/U-first order. */
    private fun PackedOrder.swapped(): PackedOrder = when (this) {
        PackedOrder.NV21 -> PackedOrder.NV12
        PackedOrder.NV12 -> PackedOrder.NV21
        PackedOrder.I420 -> PackedOrder.YV12
        PackedOrder.YV12 -> PackedOrder.I420
    }
}
