# Android client

The Android app connects Meta AI glasses to the Second Look server: it streams POV
frames over the Display and Automation SDK and shows live verdicts (Pass / Warn /
Blocked / Needs human) from the existing `POST /api/events` + `GET /api/verdicts`
endpoints. No server changes were needed.

SDK research notes live in [ANDROID-NOTES.md](ANDROID-NOTES.md).

## Layout

- `core/` pure JVM module (no Android dependency). HTTP + SSE client for the Second
  Look API, JSON and verdict helpers. Unit tested, runs anywhere.
- `app/` Android app (minSdk 29, targetSdk 36), Kotlin + Compose.
  - `session/SessionViewModel.kt` owns registration, permission, session, camera
    and streaming state.
  - `frames/YuvJpeg.kt` converts uncompressed SDK frames to JPEG bytes.
  - `ui/Screens.kt` one screen: status, controls, error line, verdict list.
  - `MockPanel.kt` exists in `debug` (MockDeviceKit pairing panel) and `release`
    (empty stub) source sets, so mock SDK code never ships in release builds.

## Build

Prereqs: Android SDK with platform 36, JDK 17+.

```sh
cd apps/android
ANDROID_HOME=~/Library/Android/sdk ./gradlew :core:test :app:assembleDebug
```

Verified Oct 28, 2026: `:core:test` 13/13 pass, `:app:assembleDebug` and
`:app:assembleRelease` both build.

## How it works

1. On launch the app calls `Wearables.initialize` and starts registration with the
   app package name. Registration state and errors are observed before use.
2. Camera permission is checked with `Wearables.checkPermissionStatus`; if not
   granted, the app requests it through the SDK `RequestPermissionContract`.
3. Start creates a session with `AutoDeviceSelector`, attaches a camera with
   `StreamConfiguration(LOW, 2fps)`, and collects `videoStream`.
4. Each uncompressed frame is converted to JPEG 60 and POSTed to `/api/events`
   inside the `frame.pov` field as a data URL. The server gate ignores the image
   bytes today (see next steps), so text events keep working unchanged.
5. Verdicts arrive over SSE from `/api/verdicts?sessionId=` and render newest-first
   with the shared Pass / Warn / Blocked / Needs human vocabulary.

Debug builds show a mock panel that enables MockDeviceKit, grants permission, and
pairs virtual Ray-Ban Meta glasses, so the flow can be exercised without hardware.

## Limits and next steps

- Frame upload rides the text event channel; server-side JPEG decode for vision
  (Spark/SAM on the image bytes) is the next server milestone.
- Uncompressed YUV plane order is undocumented; the converter assumes NV21 and
  drops frames it cannot parse (logged, no crash). Verify on hardware.
- Real-device pairing, full camera-permission UX polish, video recording, and
  entry filing still need a human with hardware. See STATUS.md.
