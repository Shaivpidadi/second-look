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
import com.secondlook.core.session.FailureKind
import com.secondlook.core.session.FailureState
import com.secondlook.core.session.RetryPolicy
import com.secondlook.core.session.SeenIds
import com.secondlook.core.session.SessionMemory
import com.secondlook.core.session.glassesFailure
import com.secondlook.core.session.lowQuality
import com.secondlook.core.session.networkFailure
import com.secondlook.core.session.permissionFailure
import com.secondlook.core.session.phoneCameraFailure
import com.secondlook.core.speech.SpeakDebounce
import com.secondlook.core.speech.phraseFor
import java.time.Instant
import java.util.UUID
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
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

    private val _failure = MutableStateFlow<FailureState?>(null)
    val failure: StateFlow<FailureState?> = _failure.asStateFlow()

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
    private val sessionMemory = SessionMemory()
    private val seenVerdictIds = SeenIds()

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
                setFailure(glassesFailure("registration: ${error.toString()}", "Glasses pairing failed."))
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
                onFailure = { error, _ ->
                    setFailure(glassesFailure("permission check: ${error.toString()}", null))
                },
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
                    // SSE is the backup channel: POST responses carry the
                    // same verdicts, and ingest dedupes by verdict id.
                    // Reconnects with backoff; Stop/Start recovers from a
                    // latched failure.
                    val retry = RetryPolicy()
                    var attempt = 0
                    while (true) {
                        try {
                            api.verdicts(sessionId).collect { verdict ->
                                ingestVerdict(verdict)
                            }
                            break
                        } catch (e: CancellationException) {
                            throw e
                        } catch (e: Exception) {
                            val failure = networkFailure(e)
                            setFailure(failure)
                            if (!retry.shouldRetry(failure, attempt)) break
                            delay(retry.delayForAttempt(attempt))
                            attempt++
                        }
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

    fun clearFailure() {
        _failure.value = null
    }

    private suspend fun startGlasses(api: SecondLookApi): Boolean {
        if (!ensureCameraPermission()) {
            setFailure(permissionFailure(phone = false))
            return false
        }
        val newSession = Wearables.createSession(AutoDeviceSelector()).getOrNull()
        if (newSession == null) {
            setFailure(glassesFailure("createSession failed. Check pairing, then tap Start.", "Glasses not reachable."))
            return false
        }
        session = newSession
        // Observe state and errors BEFORE start(), per the SDK guide.
        jobs = jobs + viewModelScope.launch {
            newSession.errors.collect { error ->
                setFailure(glassesFailure("session: ${error.name}"))
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
        if (!ensurePhonePermission()) {
            setFailure(permissionFailure(phone = true))
            return false
        }
        val owner = phoneLifecycleOwner
        if (owner == null) {
            setFailure(phoneCameraFailure("phone camera needs the activity lifecycle", null))
            return false
        }
        val source = PhoneCameraSource(
            getApplication(),
            owner,
            onJpeg = { jpeg -> viewModelScope.launch { postJpeg(api, jpeg) } },
            onError = { message -> setFailure(phoneCameraFailure(message)) },
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
            setFailure(phoneCameraFailure("phone camera permission request needs the activity", null))
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
            setFailure(glassesFailure("permission check failed", null))
            return false
        }
        if (checked is PermissionStatus.Granted) {
            _cameraGranted.value = true
            return true
        }
        val requester = permissionRequester
        if (requester == null) {
            setFailure(glassesFailure("camera permission request needs the activity", null))
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
            setFailure(glassesFailure("addCamera failed. Tap Stop, then Start to retry."))
            return
        }
        camera = attached
        jobs = jobs + viewModelScope.launch {
            attached.stream.errorStream.collect { error ->
                setFailure(glassesFailure("stream: ${error.name}"))
            }
        }
        jobs = jobs + viewModelScope.launch(Dispatchers.IO) {
            attached.stream.videoStream.collect { frame -> onFrame(frame, api) }
        }
        attached.stream.start().onFailure { error, _ ->
            setFailure(glassesFailure("stream.start: ${error.toString()}"))
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
            val posted = api.postFrame(
                FrameEvent(sessionId, Instant.now().toString(), jpeg, sessionMemory.snapshot()),
            )
            sessionMemory.learn(posted.document, posted.readings)
            posted.verdicts.forEach { ingestVerdict(it) }
            _framesPosted.update { it + 1 }
            clearNetworkFailure()
        } catch (e: Exception) {
            setFailure(networkFailure(e))
        }
    }

    /** A good upload clears a latched network failure. */
    private fun clearNetworkFailure() {
        when (_failure.value?.kind) {
            FailureKind.SERVER_UNREACHABLE, FailureKind.TIMEOUT, FailureKind.SERVER_ERROR ->
                _failure.value = null
            else -> Unit
        }
    }

    /**
     * Render and speak one verdict from either channel, skipping ids
     * already seen on the other channel.
     */
    private fun ingestVerdict(verdict: LiveVerdict) {
        if (!seenVerdictIds.add(verdict.id)) return
        _verdicts.update { (listOf(verdict) + it).take(MAX_VERDICTS) }
        maybeSpeak(verdict)
        trackQuality(verdict)
    }

    /**
     * The abstention gate doubles as the quality detector: unreadable
     * frames ask the user to hold still, and the state self-clears on
     * the next readable verdict.
     */
    private fun trackQuality(verdict: LiveVerdict) {
        val unreadable = verdict.failures.any { it.rule == "unreadable" || it.rule == "low_confidence" }
        if (verdict.state == "needs-human" && unreadable) {
            setFailure(lowQuality())
        } else if (_failure.value?.kind == FailureKind.LOW_QUALITY) {
            _failure.value = null
        }
    }

    private fun setFailure(state: FailureState) {
        Log.w(TAG, state.detail)
        _failure.value = state
        val line = state.spokenLine
        if (line != null && _speakVerdicts.value &&
            speakDebounce.shouldSpeakKey("failure:${state.kind}", System.currentTimeMillis())
        ) {
            speaker.speak(line)
        }
    }
}
