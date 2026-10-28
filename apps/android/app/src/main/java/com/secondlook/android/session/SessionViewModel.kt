package com.secondlook.android.session

import android.app.Application
import android.graphics.Bitmap
import android.util.Log
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.meta.wearable.dat.camera.Camera
import com.meta.wearable.dat.camera.addCamera
import com.meta.wearable.dat.camera.types.StreamConfiguration
import com.meta.wearable.dat.camera.types.VideoQuality
import com.meta.wearable.dat.core.Wearables
import com.meta.wearable.dat.core.selectors.AutoDeviceSelector
import com.meta.wearable.dat.core.session.DeviceSession
import com.meta.wearable.dat.core.session.DeviceSessionState
import com.meta.wearable.dat.core.types.Permission
import com.meta.wearable.dat.core.types.PermissionStatus
import com.meta.wearable.dat.core.types.RegistrationState
import com.secondlook.android.frames.YuvJpeg
import com.secondlook.core.api.FrameEvent
import com.secondlook.core.api.LiveVerdict
import com.secondlook.core.api.SecondLookApi
import java.time.Instant
import java.util.UUID
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private const val TAG = "SecondLookSession"

/** Frames per second requested from the glasses (SDK allows 2, 7, 15, 24, 30). */
private const val STREAM_FPS = 2

/** JPEG quality for uploaded frames (0-100). */
private const val JPEG_QUALITY = 60

/** Verdicts kept on screen (newest first). */
private const val MAX_VERDICTS = 20

/**
 * Owns the glasses lifecycle: registration state, camera
 * permission, session + camera start/stop, frame upload, and the
 * verdict stream. One instance per activity.
 */
class SessionViewModel(application: Application) : AndroidViewModel(application) {
    /** Base URL of the Second Look web app (emulator loopback by default). */
    var serverUrl = "http://10.0.2.2:3100"
        private set

    /** Stable session id for this run; the dashboard can watch it. */
    val sessionId: String = UUID.randomUUID().toString()

    /**
     * Set by the activity: launches the DAT permission contract and
     * suspends for the result. The ViewModel cannot own the
     * Activity Result launcher itself.
     */
    var permissionRequester: (suspend (Permission) -> PermissionStatus)? = null

    private val _isRegistered = MutableStateFlow(false)
    val isRegistered: StateFlow<Boolean> = _isRegistered.asStateFlow()

    private val _cameraGranted = MutableStateFlow<Boolean?>(null)
    val cameraGranted: StateFlow<Boolean?> = _cameraGranted.asStateFlow()

    private val _sessionState = MutableStateFlow("IDLE")
    val sessionState: StateFlow<String> = _sessionState.asStateFlow()

    private val _streaming = MutableStateFlow(false)
    val streaming: StateFlow<Boolean> = _streaming.asStateFlow()

    private val _preview = MutableStateFlow<Bitmap?>(null)
    val preview: StateFlow<Bitmap?> = _preview.asStateFlow()

    private val _verdicts = MutableStateFlow<List<LiveVerdict>>(emptyList())
    val verdicts: StateFlow<List<LiveVerdict>> = _verdicts.asStateFlow()

    private val _framesPosted = MutableStateFlow(0)
    val framesPosted: StateFlow<Int> = _framesPosted.asStateFlow()

    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error.asStateFlow()

    private var session: DeviceSession? = null
    private var camera: Camera? = null
    private var jobs: List<Job> = emptyList()

    init {
        viewModelScope.launch {
            Wearables.registrationState.collect { state ->
                _isRegistered.value = state == RegistrationState.REGISTERED
            }
        }
        viewModelScope.launch {
            Wearables.registrationErrorStream.collect { error ->
                setError("registration: ${error.toString()}")
            }
        }
        refreshPermission()
    }

    fun setServerUrl(url: String) {
        serverUrl = url.trimEnd('/')
    }

    fun register(activity: android.app.Activity) {
        Wearables.startRegistration(activity)
    }

    fun refreshPermission() {
        viewModelScope.launch {
            Wearables.checkPermissionStatus(Permission.CAMERA).fold(
                onSuccess = { status -> _cameraGranted.value = status is PermissionStatus.Granted },
                onFailure = { error, _ -> setError("permission check: ${error.toString()}") },
            )
        }
    }

    /** Start session, camera, upload, and verdict stream. */
    fun start() {
        if (_streaming.value) return
        viewModelScope.launch {
            if (!ensureCameraPermission()) return@launch
            val newSession = Wearables.createSession(AutoDeviceSelector()).getOrNull()
            if (newSession == null) {
                setError("createSession failed")
                return@launch
            }
            session = newSession
            val api = SecondLookApi(serverUrl)
            // Observe state and errors BEFORE start(), per the SDK guide.
            jobs = listOf(
                launch {
                    newSession.errors.collect { error ->
                        setError("session: ${error.name}")
                    }
                },
                launch {
                    newSession.state.collect { state ->
                        _sessionState.value = state.name
                        if (state == DeviceSessionState.STARTED) attachCamera(newSession, api)
                    }
                },
                launch {
                    try {
                        api.verdicts(sessionId).collect { verdict ->
                            _verdicts.update { (listOf(verdict) + it).take(MAX_VERDICTS) }
                        }
                    } catch (e: Exception) {
                        setError("verdicts: ${e.message}")
                    }
                },
            )
            newSession.start()
        }
    }

    /** Stop stream, camera, and session; safe to call twice. */
    fun stop() {
        jobs.forEach { it.cancel() }
        jobs = emptyList()
        try {
            camera?.stop()
        } catch (e: Exception) {
            Log.w(TAG, "camera.stop failed", e)
        }
        try {
            session?.stop()
        } catch (e: Exception) {
            Log.w(TAG, "session.stop failed", e)
        }
        camera = null
        session = null
        _streaming.value = false
        _sessionState.value = DeviceSessionState.STOPPED.name
    }

    fun clearError() {
        _error.value = null
    }

    override fun onCleared() {
        stop()
    }

    private suspend fun ensureCameraPermission(): Boolean {
        if (_cameraGranted.value == true) return true
        val checked = Wearables.checkPermissionStatus(Permission.CAMERA).getOrNull()
        if (checked == null) {
            setError("permission check failed")
            return false
        }
        if (checked is PermissionStatus.Granted) {
            _cameraGranted.value = true
            return true
        }
        val requester = permissionRequester
        if (requester == null) {
            setError("camera permission request needs the activity")
            return false
        }
        val result = requester(Permission.CAMERA)
        val granted = result is PermissionStatus.Granted
        _cameraGranted.value = granted
        return granted
    }

    private suspend fun attachCamera(active: DeviceSession, api: SecondLookApi) {
        if (camera != null) return
        val attached = active.addCamera(
            StreamConfiguration(videoQuality = VideoQuality.LOW, frameRate = STREAM_FPS),
        ).getOrNull()
        if (attached == null) {
            setError("addCamera failed")
            return
        }
        camera = attached
        jobs = jobs + viewModelScope.launch {
            attached.stream.errorStream.collect { error ->
                setError("stream: ${error.name}")
            }
        }
        jobs = jobs + viewModelScope.launch(Dispatchers.IO) {
            attached.stream.videoStream.collect { frame -> onFrame(frame, api) }
        }
        attached.stream.start().onFailure { error, _ ->
            setError("stream.start: ${error.toString()}")
        }
        _streaming.value = true
    }

    private suspend fun onFrame(
        frame: com.meta.wearable.dat.camera.types.VideoFrame,
        api: SecondLookApi,
    ) {
        if (frame.isCompressed || frame.isCodecConfig) return
        val jpeg = withContext(Dispatchers.Default) {
            YuvJpeg.encode(frame.buffer, frame.width, frame.height, isCompressed = false, JPEG_QUALITY)
        } ?: return
        withContext(Dispatchers.Default) {
            YuvJpeg.decode(jpeg)
        }?.let { _preview.value = it }
        try {
            api.postFrame(FrameEvent(sessionId, Instant.now().toString(), jpeg))
            _framesPosted.update { it + 1 }
        } catch (e: Exception) {
            setError("upload: ${e.message}")
        }
    }

    private fun setError(message: String) {
        Log.w(TAG, message)
        _error.value = message
    }
}
