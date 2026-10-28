package com.secondlook.android.session

import android.Manifest
import android.app.Application
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.util.Log
import androidx.core.content.ContextCompat
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.LifecycleOwner
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
import com.secondlook.android.frames.PhoneCameraSource
import com.secondlook.android.frames.VerdictSpeaker
import com.secondlook.android.frames.YuvJpeg
import com.secondlook.core.api.FrameEvent
import com.secondlook.core.api.LiveVerdict
import com.secondlook.core.api.SecondLookApi
import com.secondlook.core.speech.SpeakDebounce
import com.secondlook.core.speech.phraseFor
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

    /**
     * Set by the activity: the lifecycle CameraX binds to, plus a
     * suspend requester for the Android CAMERA runtime permission.
     */
    var phoneLifecycleOwner: LifecycleOwner? = null
    var phonePermissionRequester: (suspend () -> Boolean)? = null

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

    private val _usePhoneCamera = MutableStateFlow(false)
    val usePhoneCamera: StateFlow<Boolean> = _usePhoneCamera.asStateFlow()

    private val _streamFps = MutableStateFlow(2)
    val streamFps: StateFlow<Int> = _streamFps.asStateFlow()

    /**
     * Manual chroma-order override: flips the undetectable V-first /
     * U-first order when the preview colors look wrong on the day.
     */
    private val _chromaSwapped = MutableStateFlow(false)
    val chromaSwapped: StateFlow<Boolean> = _chromaSwapped.asStateFlow()

    private val _speakVerdicts = MutableStateFlow(true)
    val speakVerdicts: StateFlow<Boolean> = _speakVerdicts.asStateFlow()

    private val _cleanTone = MutableStateFlow(false)
    val cleanTone: StateFlow<Boolean> = _cleanTone.asStateFlow()

    private val speaker by lazy { VerdictSpeaker(getApplication()) }
    private val speakDebounce = SpeakDebounce()

    private var session: DeviceSession? = null
    private var camera: Camera? = null
    private var phoneSource: PhoneCameraSource? = null
    private var jobs: List<Job> = emptyList()
    private var loggedOrder = false

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

    fun toggleCameraSource() {
        if (_streaming.value) return
        _usePhoneCamera.update { !it }
    }

    fun setStreamFps(fps: Int) {
        _streamFps.value = fps.coerceIn(2, 7)
        phoneSource?.fps = _streamFps.value
    }

    fun toggleChromaSwapped() {
        _chromaSwapped.update { !it }
    }

    fun toggleSpeakVerdicts() {
        _speakVerdicts.update { !it }
    }

    fun toggleCleanTone() {
        _cleanTone.update { !it }
    }

    /** Start session, camera, upload, and verdict stream. */
    fun start() {
        if (_streaming.value) return
        loggedOrder = false
        viewModelScope.launch {
            val api = SecondLookApi(serverUrl)
            jobs = listOf(
                launch {
                    try {
                        api.verdicts(sessionId).collect { verdict ->
                            _verdicts.update { (listOf(verdict) + it).take(MAX_VERDICTS) }
                            maybeSpeak(verdict)
                        }
                    } catch (e: Exception) {
                        setError("verdicts: ${e.message}")
                    }
                },
            )
            val started = if (_usePhoneCamera.value) {
                startPhone(api)
            } else {
                startGlasses(api)
            }
            if (!started) {
                jobs.forEach { it.cancel() }
                jobs = emptyList()
            }
        }
    }

    /** Stop stream, camera, and session; safe to call twice. */
    fun stop() {
        jobs.forEach { it.cancel() }
        jobs = emptyList()
        try {
            phoneSource?.stop()
        } catch (e: Exception) {
            Log.w(TAG, "phoneSource.stop failed", e)
        }
        phoneSource = null
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

    private suspend fun startGlasses(api: SecondLookApi): Boolean {
        if (!ensureCameraPermission()) return false
        val newSession = Wearables.createSession(AutoDeviceSelector()).getOrNull()
        if (newSession == null) {
            setError("createSession failed")
            return false
        }
        session = newSession
        // Observe state and errors BEFORE start(), per the SDK guide.
        jobs = jobs + viewModelScope.launch {
            newSession.errors.collect { error ->
                setError("session: ${error.name}")
            }
        } + viewModelScope.launch {
            newSession.state.collect { state ->
                _sessionState.value = state.name
                if (state == DeviceSessionState.STARTED) attachCamera(newSession, api)
            }
        }
        newSession.start()
        return true
    }

    private suspend fun startPhone(api: SecondLookApi): Boolean {
        if (!ensurePhonePermission()) return false
        val owner = phoneLifecycleOwner
        if (owner == null) {
            setError("phone camera needs the activity lifecycle")
            return false
        }
        val source = PhoneCameraSource(
            getApplication(),
            owner,
            onJpeg = { jpeg -> viewModelScope.launch { postJpeg(api, jpeg) } },
            onError = { message -> setError(message) },
        )
        source.fps = _streamFps.value
        source.quality = JPEG_QUALITY
        phoneSource = source
        source.start()
        _sessionState.value = "PHONE"
        _streaming.value = true
        return true
    }

    private suspend fun ensurePhonePermission(): Boolean {
        val context = getApplication<Application>()
        if (
            ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) ==
            PackageManager.PERMISSION_GRANTED
        ) {
            return true
        }
        val requester = phonePermissionRequester
        if (requester == null) {
            setError("phone camera permission request needs the activity")
            return false
        }
        return requester()
    }

    override fun onCleared() {
        stop()
        try {
            speaker.shutdown()
        } catch (e: Exception) {
            Log.w(TAG, "speaker shutdown failed", e)
        }
    }

    private fun maybeSpeak(verdict: LiveVerdict) {
        val phrase = phraseFor(verdict)
        if (phrase != null) {
            if (!_speakVerdicts.value) return
            if (!speakDebounce.shouldSpeak(verdict, System.currentTimeMillis())) return
            speaker.speak(phrase)
            return
        }
        if (verdict.state == "clean" && _cleanTone.value) {
            speaker.beep()
        }
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
        if (!loggedOrder) {
            loggedOrder = true
            val order = withContext(Dispatchers.Default) {
                YuvJpeg.detect(frame.buffer, frame.width, frame.height)
            }
            Log.i(TAG, "glasses frame layout: ${order ?: "unparseable"} ${frame.width}x${frame.height}")
        }
        val jpeg = withContext(Dispatchers.Default) {
            YuvJpeg.encode(
                frame.buffer,
                frame.width,
                frame.height,
                isCompressed = false,
                JPEG_QUALITY,
                _chromaSwapped.value,
            )
        } ?: return
        postJpeg(api, jpeg)
    }

    /** Shared uploader tail: preview plus POST, for both camera sources. */
    private suspend fun postJpeg(api: SecondLookApi, jpeg: ByteArray) {
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
