# Android research notes (batch 17)

Sources read on Oct 28, 2026 (all fresh, nothing copied):

- `AGENTS.md`
  (https://github.com/facebook/meta-wearables-dat-android/blob/main/AGENTS.md):
  repo layout, Maven coordinates, manifest entries, init, permissions,
  registration, session/camera/stream lifecycle, cleanup rules,
  MockDeviceKit flows, gotchas.
- Getting started
  (https://wearables.developer.meta.com/docs/develop/dat/getting-started-toolkit):
  platform floor (Android 10+, Kotlin 2.2+, Android Studio
  Flamingo+), supported glasses, developer-mode pairing path.
- Mock Device Kit
  (https://wearables.developer.meta.com/docs/develop/dat/mock-device-kit/):
  debug-sheet flows, phone-camera vs h265 video-file feeds,
  capture image, touchpad simulation; phone camera permission is
  separate from the DAT CAMERA permission.
- Version dependencies
  (https://wearables.developer.meta.com/docs/develop/dat/version-dependencies/):
  SDK 1.0.1 needs Meta AI app V292 and glasses firmware V128;
  per-error runtime handling; Meta-AI-initiated registration via
  `Wearables.handleIntent` (SDK 1.0.0+).
- `VideoFrame` API reference
  (https://wearables.developer.meta.com/docs/reference/android/dat/1.0/com_meta_wearable_dat_camera_types_videoframe):
  `data class VideoFrame(buffer: ByteBuffer, width: Int,
  height: Int, presentationTimeUs: Long, isCompressed: Boolean,
  isCodecConfig: Boolean)`; uncompressed frames carry decoded YUV
  pixel data (exact plane layout undocumented).

## Setup facts used by the scaffold

- Maven Central, no token: `com.meta.wearable:mwdat-core:1.0.1`,
  `mwdat-camera:1.0.1`, `mwdat-mockdevice:1.0.1`.
- Manifest: BLUETOOTH, BLUETOOTH_CONNECT, INTERNET;
  `mwdat_application_id` / `mwdat_client_token` meta-data
  (0/0 for dev-mode builds); callback URI scheme intent-filter.
- `Wearables.initialize(context)` once in `Application.onCreate`.
- Registration: `Wearables.startRegistration(activity)`, observe
  `Wearables.registrationState` for REGISTERED; Meta AI can also
  initiate it (handle the intent in `onCreate`/`onNewIntent`).
- Camera permission via `checkPermissionStatus(Permission.CAMERA)`
  plus the Activity Result `RequestPermissionContract`.
- Session: `createSession(AutoDeviceSelector())`, collect
  `state`/`errors` BEFORE `start()`; attach the camera only on
  `STARTED` (`addCamera` on IDLE fails); shut down with
  `camera.stop()` then `session.stop()`.
- Stream config: quality LOW 360x640 / MEDIUM 504x896 / HIGH
  720x1280; frame rate must be one of 2, 7, 15, 24, 30.
  Frames arrive on `camera.stream.videoStream`; never mutate
  `VideoFrame.buffer` in place.
- Mock: `MockDeviceKit.getInstance(context).enable()`, then
  `pairGlasses(RAYBAN_META)`, power on, unfold, don; feed from a
  camera URI or facing; permissions forced via
  `permissions.set(...)`. Up to three mock devices.

## Architecture decisions

- `apps/android` holds two Gradle modules, no package.json, so
  the pnpm workspace globs ignore it; `.vercelignore` keeps it
  out of Vercel uploads.
- Frame transport reuses the EXISTING web pipeline with zero
  server changes: the client POSTs
  `{sessionId, fieldId: "frame.pov", value: <base64 JPEG>,
  ts}` to `/api/events` (the gate ignores unknown fields) and
  reads verdicts from the same `/api/verdicts` SSE stream as
  `/form`. The JPEG rides the event channel; decoding it for
  vision on the server is the documented next step.
- Stream at 2fps, LOW quality, JPEG quality 60: near 20-50KB
  per frame. One constant each in the app module to raise them.
- `:core` is pure JVM (HttpURLConnection, hand-written JSON for
  the small verdict shape, kotlinx-coroutines for the SSE Flow)
  so `:core:test` runs anywhere. YUV to JPEG uses
  `android.graphics.YuvImage` in `:app`, assuming NV21 layout:
  the SDK does not document the plane order, so the encoder
  catches failures and reports them instead of crashing.
- Mock flows ship in the `debug` source set; `release` carries
  a no-op stub so the mock SDK never links into release builds.
- Verdict words match the web vocabulary: Pass, Warn, Blocked,
  Needs human.
