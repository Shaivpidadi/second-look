package com.secondlook.core.frames

/**
 * YUV420 layout detection and conversion, pure JVM with no Android
 * dependency so :core unit tests cover it.
 *
 * The DAT SDK hands the app one packed buffer per frame with no layout
 * metadata (verified against mwdat-camera 1.0.1: VideoFrame carries
 * only buffer, width, height, timestamps, and codec flags), so packed
 * frames are classified by size plus a chroma-structure heuristic:
 * interleaved chroma (NV21/NV12) correlates at lag 2 but not lag 1,
 * while planar chroma (I420/YV12) correlates at both. V-first vs
 * U-first order is unknowable from bytes, so detection defaults to
 * NV21 / I420 and the app offers a manual chroma-swap override.
 *
 * Every function returns null on invalid input instead of throwing.
 */
enum class PackedOrder {
    NV21,
    NV12,
    I420,
    YV12,
}

/** Packed YUV420 byte count, or -1 when the dimensions are unusable. */
private fun packedSize(width: Int, height: Int): Int {
    if (width <= 0 || height <= 0 || width % 2 != 0 || height % 2 != 0) return -1
    // width/2 * height could overflow for absurd inputs; cap at 64 MP.
    if (width > 16384 || height > 16384) return -1
    return width * height * 3 / 2
}

/**
 * Classify one packed buffer, or null when the size does not match a
 * packed YUV420 frame of these dimensions (padded or truncated data).
 */
fun detectPackedOrder(buffer: ByteArray, width: Int, height: Int): PackedOrder? {
    val expected = packedSize(width, height)
    if (expected < 0 || buffer.size != expected) return null
    if (!looksInterleaved(buffer, width * height, expected - width * height)) {
        return PackedOrder.I420
    }
    return PackedOrder.NV21
}

/**
 * True when the chroma region looks interleaved: neighboring bytes
 * differ much more than bytes two apart (cross-channel vs spatial
 * neighbors). Flat regions read as planar, which is harmless because
 * flat chroma renders the same under any order.
 */
private fun looksInterleaved(buffer: ByteArray, offset: Int, length: Int): Boolean {
    if (length < 64) return false
    var lag1 = 0L
    var lag2 = 0L
    var samples = 0L
    var i = offset
    val end = offset + length - 2
    while (i < end) {
        val a = buffer[i].toInt() and 0xff
        val b = buffer[i + 1].toInt() and 0xff
        val c = buffer[i + 2].toInt() and 0xff
        lag1 += if (a >= b) a - b else b - a
        lag2 += if (a >= c) a - c else c - a
        samples++
        i += 8
    }
    if (samples == 0L) return false
    val mean1 = lag1.toDouble() / samples
    val mean2 = lag2.toDouble() / samples
    if (mean2 < 0.5 || mean1 < 1.5) return false
    return mean1 > 2.0 * mean2
}

/**
 * Repack one packed buffer to NV21 (Y + interleaved VU). Null when the
 * size or dimensions are invalid for the given order.
 */
fun toNv21Packed(buffer: ByteArray, width: Int, height: Int, order: PackedOrder): ByteArray? {
    val expected = packedSize(width, height)
    if (expected < 0 || buffer.size != expected) return null
    try {
        val ySize = width * height
        val uvSize = ySize / 2
        when (order) {
            PackedOrder.NV21 -> return buffer.copyOf()
            PackedOrder.NV12 -> {
                val out = buffer.copyOf()
                var i = ySize
                while (i + 1 < expected) {
                    val tmp = out[i]
                    out[i] = out[i + 1]
                    out[i + 1] = tmp
                    i += 2
                }
                return out
            }
            PackedOrder.I420, PackedOrder.YV12 -> {
                // I420: Y + U + V. YV12: Y + V + U.
                val uOff = ySize + (if (order == PackedOrder.I420) 0 else uvSize / 2)
                val vOff = ySize + (if (order == PackedOrder.I420) uvSize / 2 else 0)
                val out = ByteArray(expected)
                buffer.copyInto(out, 0, 0, ySize)
                var o = ySize
                for (k in 0 until uvSize / 2) {
                    out[o++] = buffer[vOff + k]
                    out[o++] = buffer[uOff + k]
                }
                return out
            }
        }
    } catch (_: Exception) {
        return null
    }
}

/**
 * Pack three-plane YUV420 (CameraX YUV_420_888) to NV21, honoring row
 * and pixel strides. Null on any invalid input; never throws.
 */
fun toNv21Planar(
    y: ByteArray,
    yRowStride: Int,
    u: ByteArray,
    v: ByteArray,
    uvRowStride: Int,
    uvPixelStride: Int,
    width: Int,
    height: Int,
): ByteArray? {
    if (packedSize(width, height) < 0) return null
    if (yRowStride < width || uvRowStride <= 0 || (uvPixelStride != 1 && uvPixelStride != 2)) {
        return null
    }
    val chromaWidth = width / 2
    val chromaHeight = height / 2
    val uvLast = uvRowStride * (chromaHeight - 1) + (chromaWidth - 1) * uvPixelStride
    if (y.size < yRowStride * (height - 1) + width) return null
    if (u.size <= uvLast || v.size <= uvLast) return null
    try {
        val out = ByteArray(width * height * 3 / 2)
        for (row in 0 until height) {
            y.copyInto(out, row * width, row * yRowStride, row * yRowStride + width)
        }
        var o = width * height
        for (row in 0 until chromaHeight) {
            val base = row * uvRowStride
            for (col in 0 until chromaWidth) {
                out[o++] = v[base + col * uvPixelStride]
                out[o++] = u[base + col * uvPixelStride]
            }
        }
        return out
    } catch (_: Exception) {
        return null
    }
}
