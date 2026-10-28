package com.secondlook.android.frames

import android.content.Context
import android.util.Log
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import com.secondlook.core.frames.toNv21Planar
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicLong

private const val TAG = "PhoneCameraSource"

/**
 * Phone-camera fallback source (CameraX) for when glasses pairing fails
 * on the day. Binds an ImageAnalysis stream, converts YUV_420_888
 * planes with real stride metadata via core, throttles to the
 * configured rate, and hands JPEG bytes to the same uploader tail the
 * glasses path uses.
 */
class PhoneCameraSource(
    private val context: Context,
    private val lifecycleOwner: LifecycleOwner,
    private val onJpeg: (ByteArray) -> Unit,
    private val onError: (String) -> Unit,
) {
    private var executor: ExecutorService? = null
    private val lastEmitMs = AtomicLong(0)
    @Volatile private var lastW = 0
    @Volatile private var lastH = 0

    @Volatile var fps = 2
    @Volatile var quality = 60

    /** Bind the analyzer; safe to call once per instance. */
    fun start() {
        val exec = Executors.newSingleThreadExecutor()
        executor = exec
        val future = ProcessCameraProvider.getInstance(context)
        future.addListener(
            {
                try {
                    val provider = future.get()
                    val analysis = ImageAnalysis.Builder()
                        .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_YUV_420_888)
                        .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                        .build()
                    analysis.setAnalyzer(exec) { image -> analyze(image) }
                    provider.unbindAll()
                    provider.bindToLifecycle(
                        lifecycleOwner,
                        CameraSelector.DEFAULT_BACK_CAMERA,
                        analysis,
                    )
                } catch (e: Exception) {
                    onError("phone camera start failed: ${e.message}")
                }
            },
            ContextCompat.getMainExecutor(context),
        )
    }

    fun stop() {
        try {
            ProcessCameraProvider.getInstance(context).get().unbindAll()
        } catch (e: Exception) {
            Log.w(TAG, "phone camera unbind failed", e)
        }
        executor?.shutdown()
        executor = null
    }

    private fun analyze(image: ImageProxy) {
        try {
            val intervalMs = 1000L / fps.coerceIn(2, 7)
            val now = System.currentTimeMillis()
            if (now - lastEmitMs.get() < intervalMs) return
            lastEmitMs.set(now)
            if (image.width != lastW || image.height != lastH) {
                lastW = image.width
                lastH = image.height
                Log.i(TAG, "phone frame: ${image.width}x${image.height} YUV_420_888")
            }
            val planes = image.planes
            if (planes.size < 3) {
                Log.w(TAG, "dropping phone frame: ${planes.size} planes, need 3")
                return
            }
            val y = planes[0].buffer.toBytes()
            val u = planes[1].buffer.toBytes()
            val v = planes[2].buffer.toBytes()
            val nv21 = toNv21Planar(
                y,
                planes[0].rowStride,
                u,
                v,
                planes[1].rowStride,
                planes[1].pixelStride,
                image.width,
                image.height,
            )
            if (nv21 == null) {
                Log.w(TAG, "dropping phone frame: cannot pack ${image.width}x${image.height}")
                return
            }
            val jpeg = YuvJpeg.encodeNv21(nv21, image.width, image.height, quality)
            if (jpeg == null) {
                Log.w(TAG, "dropping phone frame: JPEG encode failed")
                return
            }
            onJpeg(jpeg)
        } catch (e: Exception) {
            Log.w(TAG, "dropping phone frame", e)
        } finally {
            try {
                image.close()
            } catch (_: Exception) {
            }
        }
    }

    private fun java.nio.ByteBuffer.toBytes(): ByteArray {
        val out = ByteArray(remaining())
        duplicate().get(out)
        return out
    }
}
