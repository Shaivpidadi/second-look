# Android client

The Android app connects Meta AI glasses to the Second Look server: it streams POV
frames over the Display and Automation SDK and shows live verdicts (Pass / Warn /
Blocked / Needs human) from the existing `POST /api/events` + `GET /api/verdicts`
endpoints. Frames are judged by the server vision path (Spark boxes, abstention
gate, judge); see the frame protocol below.

SDK research notes live in [ANDROID-NOTES.md](ANDROID-NOTES.md).

## Layout

- `core/` pure JVM module (no Android dependency). HTTP + SSE client for the Second
  Look API, JSON and verdict helpers, YUV420 layout detection and conversion.
  Unit tested, runs anywhere.
- `app/` Android app (minSdk 29, targetSdk 36), Kotlin + Compose.
  - `session/SessionViewModel.kt` owns registration, permission, session, camera
    and streaming state, plus the camera-source, fps, and chroma toggles.
  - `frames/YuvJpeg.kt` classifies packed SDK frames and converts them to JPEG.
  - `frames/PhoneCameraSource.kt` CameraX fallback that streams the phone camera
    through the same uploader when glasses pairing fails.
  - `ui/Screens.kt` one screen: status, controls, error line, verdict list.
  - `MockPanel.kt` exists in `debug` (MockDeviceKit pairing panel) and `release`
    (empty stub) source sets, so mock SDK code never ships in release builds.
  - `debug/` also carries a network security config that allows LAN cleartext
    HTTP; release builds stay HTTPS-only (verified in the merged manifest).

## Build

Prereqs: Android SDK with platform 36, JDK 17+.

```sh
cd apps/android
ANDROID_HOME=~/Library/Android/sdk ./gradlew :core:test :app:assembleDebug
```

Verified Oct 28, 2026: `:core:test` 22/22 pass, `:app:assembleDebug` and
`:app:assembleRelease` both build.

## Frame protocol

Each frame is one `POST /api/events` with `fieldId: "frame.pov"` and the JPEG
as a `data:image/jpeg;base64,...` data URL in `value`. The server:

1. Validates mime (JPEG or PNG), strict base64, and a 2 MB decoded cap,
   rejecting violations with a clear 4xx.
2. Decodes once with its dependency-free codec and hashes with `frameHash`.
3. Drops near-duplicate keyframes (dhash distance under 8 bits) so a steady
   2 fps stream does not trigger a model call per frame.
4. Budgets 10 model calls per rolling minute per session; over-budget frames
   publish a visible `throttled` verdict instead of a silent drop.
5. Judges kept keyframes (document localization, then the image-grounded
   judge) and publishes on the same SSE stream as text events. Unreadable or
   unsure fields abstain to Needs human.

Live proof (Oct 28): a real fixture JPEG through this path returned a clean
verdict in 6.6s, and the same frame with a corrupted typed field returned a
mismatch naming the paper value as the fix in 7.6s. Two model calls each.

## How it works

1. On launch the app calls `Wearables.initialize` and starts registration with the
   app package name. Registration state and errors are observed before use.
2. Camera permission is checked with `Wearables.checkPermissionStatus`; if not
   granted, the app requests it through the SDK `RequestPermissionContract`.
3. Start creates a session with `AutoDeviceSelector`, attaches a camera with
   `StreamConfiguration(LOW, 2fps)`, and collects `videoStream`.
4. Each uncompressed frame is classified (NV21 vs I420 packed layouts; the SDK
   exposes no layout metadata, verified against mwdat-camera 1.0.1), converted
   to JPEG 60, and POSTed as a `frame.pov` data URL. Unparseable frames are
   dropped with a log line, never a crash. A chroma-swap toggle flips the
   undetectable V-first/U-first order if preview colors look wrong.
5. Verdicts arrive over SSE from `/api/verdicts?sessionId=` and render newest-first
   with the shared Pass / Warn / Blocked / Needs human vocabulary.

Debug builds show a mock panel that enables MockDeviceKit, grants permission, and
pairs virtual Ray-Ban Meta glasses, so the flow can be exercised without hardware.

## Phone fallback and LAN dev

- The camera screen has a source toggle (glasses/phone, switchable while idle),
  an fps stepper (2 to 7, live), and the chroma-swap toggle. The phone path
  requests the Android CAMERA permission at Start and streams CameraX
  YUV_420_888 frames with real stride metadata through the same uploader.
- For LAN dev, run the web app on the Mac Studio bound to all interfaces:
  `pnpm --filter @second-look/web dev -- -p 3100 -H 0.0.0.0` (port 3100 is
  the repo convention). Find the Mac IP (System Settings / Wi-Fi / Details,
  or `ipconfig getifaddr en0`), join the phone to the same Wi-Fi, install
  the debug APK, and set the Server URL field to `http://<mac-ip>:3100`.
  Cleartext HTTP works in debug builds only.

## Limits and next steps

- Single-frame verdicts cover visible fields only; a BOL frame cannot catch an
  AWB error in another document. Cross-frame paper-value accumulation is future
  work.
- Real-device pairing, video recording, and entry filing still need a human
  with hardware. See STATUS.md.

## What Shaishav must do by hand

1. Install the debug APK on his Android phone via adb or Android Studio.
2. Enable glasses camera access in the Meta AI app.
3. Start the Mac server bound to 0.0.0.0 and note the Mac LAN IP.
4. Set the base URL field in the app to `http://<mac-ip>:3100`.
5. Run the first real pairing test: register, grant camera, Start on glasses,
   confirm frames post and verdicts stream (fall back to the phone source and
   the chroma toggle if pairing or colors misbehave).
