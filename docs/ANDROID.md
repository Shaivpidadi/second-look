# Android client

The Android app connects Meta AI glasses to the Second Look server: it streams POV
frames over the Display and Automation SDK and shows live verdicts (Pass / Warn /
Blocked / Needs human) from the existing `POST /api/events` + `GET /api/verdicts`
endpoints. Frames are judged by the server vision path (Spark boxes, abstention
gate, judge); see the frame protocol below.

SDK research notes live in [ANDROID-NOTES.md](ANDROID-NOTES.md).

## Layout

- `core/` pure JVM module (no Android dependency). HTTP + SSE client for the Second
  Look API, JSON and verdict helpers, YUV420 layout detection and conversion,
  spoken-verdict phrases and debounce. Unit tested, runs anywhere.
- `app/` Android app (minSdk 29, targetSdk 36), Kotlin + Compose.
  - `session/SessionViewModel.kt` owns registration, permission, session, camera
    and streaming state, plus the camera-source, fps, chroma, speech, and tone
    toggles.
  - `frames/YuvJpeg.kt` classifies packed SDK frames and converts them to JPEG.
  - `frames/PhoneCameraSource.kt` CameraX fallback that streams the phone camera
    through the same uploader when glasses pairing fails.
  - `frames/VerdictSpeaker.kt` speaks mismatch/blocked verdicts over TTS and
    beeps on clean when the tone setting is on.
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

Verified Oct 28, 2026: `:core:test` 29/29 pass, `:app:assembleDebug` and
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

Judged frames also feed session document memory: paper fields per doc type
(no image bytes, capped, expires with the session). Once two documents are
known, the cross-document validator runs over everything seen and publishes
`frame.crossdoc` verdicts naming both documents and the conflicting field.

Live proof (Oct 28): a BOL then a cross-form AWB returned a cross-doc verdict
("BOL weight 2064kg vs AWB weight 3887kg") in 4 calls; per-frame totals 5.0s
and 2.9s. Fresh-frame median is 3.6s after boxes/judge parallelization
(measured 4.2s, 3.6s, 3.0s).

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
6. Mismatch and blocked verdicts are spoken over TTS ("Container number does
   not match the bill of lading"), routed by the system to the glasses when
   they are the connected Bluetooth audio device. Identical verdicts are
   debounced for 30s. Clean verdicts beep only when the tone setting is on.

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

- Single-frame verdicts cover the visible document only; cross-document
  checks run over session memory, which the app also sends as a compact
  field summary so they survive a multi-instance host.
- Real-device pairing, video recording, and entry filing still need a human
  with hardware. See STATUS.md.

## What Shaishav must do by hand

1. On the Mac, run `pnpm demo:lan`, then `pnpm demo:preflight` to confirm
   the server, the API key, and the printed LAN URL.
2. Install the debug APK on his Android phone via adb or Android Studio.
3. Enable glasses camera access in the Meta AI app.
4. Set the base URL field in the app to the printed LAN URL.
5. Open Check setup in the app and confirm every row passes (server,
   key, glasses link, audio route); fix failures before continuing.
6. Run the first real pairing test: register, grant camera, Start on glasses,
   confirm frames post and verdicts stream (fall back to the phone source and
   the chroma toggle if pairing or colors misbehave). Confirm spoken verdicts
   play through the glasses; toggle Speech and Clean tone to taste.
