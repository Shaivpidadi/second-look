package com.secondlook.core.frames

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class YuvTest {
    private val width = 16
    private val height = 16
    private val ySize = width * height
    private val uvCount = ySize / 4

    /** Smooth U/V ramps: spatial neighbors close, channels apart. */
    private fun channels(): Pair<ByteArray, ByteArray> {
        val u = ByteArray(uvCount) { k -> (100 + (k % 16) * 2).toByte() }
        val v = ByteArray(uvCount) { k -> (140 + (k % 16) * 2).toByte() }
        return u to v
    }

    private fun nv21(u: ByteArray, v: ByteArray): ByteArray {
        val out = ByteArray(ySize * 3 / 2) { 16 }
        for (k in u.indices) {
            out[ySize + k * 2] = v[k]
            out[ySize + k * 2 + 1] = u[k]
        }
        return out
    }

    private fun i420(u: ByteArray, v: ByteArray): ByteArray {
        val out = ByteArray(ySize * 3 / 2) { 16 }
        u.copyInto(out, ySize)
        v.copyInto(out, ySize + uvCount)
        return out
    }

    @Test
    fun `detects interleaved chroma as NV21`() {
        val (u, v) = channels()
        assertEquals(PackedOrder.NV21, detectPackedOrder(nv21(u, v), width, height))
        // NV12 differs only in U/V order, which bytes cannot reveal.
        val nv12 = nv21(u, v).copyOf()
        for (i in ySize until nv12.size step 2) {
            val tmp = nv12[i]
            nv12[i] = nv12[i + 1]
            nv12[i + 1] = tmp
        }
        assertEquals(PackedOrder.NV21, detectPackedOrder(nv12, width, height))
    }

    @Test
    fun `detects planar chroma as I420`() {
        val (u, v) = channels()
        assertEquals(PackedOrder.I420, detectPackedOrder(i420(u, v), width, height))
    }

    @Test
    fun `rejects size mismatches and odd dimensions`() {
        val (u, v) = channels()
        val frame = nv21(u, v)
        assertNull(detectPackedOrder(frame.copyOf(frame.size - 1), width, height))
        assertNull(detectPackedOrder(frame + 0, width, height))
        assertNull(detectPackedOrder(frame, width + 1, height))
        assertNull(detectPackedOrder(frame, 0, height))
    }

    @Test
    fun `NV21 repack is identity, NV12 swaps pairs`() {
        val (u, v) = channels()
        val frame = nv21(u, v)
        assertArrayEquals(frame, toNv21Packed(frame, width, height, PackedOrder.NV21))
        val nv12 = frame.copyOf()
        for (i in ySize until nv12.size step 2) {
            val tmp = nv12[i]
            nv12[i] = nv12[i + 1]
            nv12[i + 1] = tmp
        }
        assertArrayEquals(frame, toNv21Packed(nv12, width, height, PackedOrder.NV12))
    }

    @Test
    fun `planar repack interleaves V before U`() {
        val (u, v) = channels()
        val expected = nv21(u, v)
        assertArrayEquals(expected, toNv21Packed(i420(u, v), width, height, PackedOrder.I420))
        // YV12 stores V first; same expected output.
        val yv12 = ByteArray(ySize * 3 / 2) { 16 }
        v.copyInto(yv12, ySize)
        u.copyInto(yv12, ySize + uvCount)
        assertArrayEquals(expected, toNv21Packed(yv12, width, height, PackedOrder.YV12))
    }

    @Test
    fun `packed repack returns null on invalid input`() {
        val (u, v) = channels()
        val frame = nv21(u, v)
        assertNull(toNv21Packed(frame.copyOf(frame.size - 2), width, height, PackedOrder.NV21))
        assertNull(toNv21Packed(frame, width, height + 1, PackedOrder.I420))
    }

    @Test
    fun `planar repack honors row and pixel strides`() {
        val yStride = width + 8
        val uvStride = 8 + 4
        val y = ByteArray(yStride * height) { row -> 0 }
        for (row in 0 until height) {
            for (col in 0 until width) y[row * yStride + col] = (row + col).toByte()
        }
        val u = ByteArray(uvStride * (height / 2)) { k -> (k % 251).toByte() }
        val v = ByteArray(uvStride * (height / 2)) { k -> (200 - k % 251).toByte() }
        val packed = toNv21Planar(y, yStride, u, v, uvStride, 1, width, height)
        assertTrue(packed != null)
        packed as ByteArray
        assertEquals(ySize * 3 / 2, packed.size)
        for (row in 0 until height) {
            for (col in 0 until width) {
                assertEquals((row + col).toByte(), packed[row * width + col])
            }
        }
        for (row in 0 until height / 2) {
            for (col in 0 until width / 2) {
                val o = ySize + (row * (width / 2) + col) * 2
                assertEquals(v[row * uvStride + col], packed[o])
                assertEquals(u[row * uvStride + col], packed[o + 1])
            }
        }
    }

    @Test
    fun `planar repack honors pixel stride 2`() {
        val uvStride = width
        val u = ByteArray(uvStride * (height / 2)) { k -> if (k % 2 == 0) 10 else 99 }
        val v = ByteArray(uvStride * (height / 2)) { k -> if (k % 2 == 0) 20 else 99 }
        val y = ByteArray(width * height) { 16 }
        val packed = toNv21Planar(y, width, u, v, uvStride, 2, width, height)
        assertTrue(packed != null)
        packed as ByteArray
        for (o in ySize until packed.size step 2) {
            assertEquals(20.toByte(), packed[o])
            assertEquals(10.toByte(), packed[o + 1])
        }
    }

    @Test
    fun `planar repack returns null on invalid input`() {
        val y = ByteArray(width * height) { 16 }
        val small = ByteArray(4) { 128.toByte() }
        val plane = ByteArray((width / 2) * (height / 2)) { 128.toByte() }
        assertNull(toNv21Planar(small, width, plane, plane, width / 2, 1, width, height))
        assertNull(toNv21Planar(y, width, small, plane, width / 2, 1, width, height))
        assertNull(toNv21Planar(y, width, plane, plane, width / 2, 3, width, height))
        assertNull(toNv21Planar(y, width - 1, plane, plane, width / 2, 1, width, height))
    }
}
