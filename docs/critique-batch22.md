# Critique batch 22: fresh-clone run vs docs

Cloned the local repo to /tmp/sl-fresh-clone (since deleted) and
followed only README.md and docs/ANDROID.md, with no .env and no
local.properties. Install, `pnpm -r test` (415 pass), `pnpm -r
typecheck`, `next build`, `pnpm check:submit` (clean), and
`:core:test` (52 pass) plus `:app:assembleDebug` (APK at
`app/build/outputs/apk/debug/app-debug.apk`) all passed. Nothing
in the required path depends on ignored or uncommitted state.

## Divergences found and fixed

1. docs/ANDROID.md said `:core:test` 29/29 pass; the clean run
   has 52 tests. A count mismatch reads as a broken checkout.
   Fixed the line to 52/52.
2. A real eval arm without a key printed a bare `unavailable`
   row with no reason, so a stranger cannot tell a broken arm
   from a missing key. Fixed in code: `formatReport` appends
   "Unavailable arms need MODEL_API_KEY (or META_API_KEY) in
   .env; see README: Run the eval." Existing row rendering is
   unchanged; one test pins the footnote.
3. docs/ANDROID.md said the source toggle is "switchable while
   idle"; batch 21 made it switchable mid-stream (live
   streams restart on the new source). Shaishav would stop the
   stream before switching for no reason. Fixed the line.

## Checked and clear (no fix)

- No .env needed for any gate; .env.example carries names
  only, no values. README says exactly what to create (`cp
  .env.example .env`, add MODEL_API_KEY) and when it matters.
- No local.properties needed: the documented ANDROID_HOME
  command builds first try.
- ffmpeg present at the documented `/opt/homebrew/bin/ffmpeg`;
  Node v22 present as required.
- clips/ and .audit/ are generated/ignored and no test needs
  them (proven by the green clone run).
