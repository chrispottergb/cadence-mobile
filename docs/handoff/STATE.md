# Cadence — handoff state (2026-09-28)

Read this first in a new session, then `guided-builder-brief.md`.

## Repos (both private, pushed, CI green)

- `chrispottergb/cadence-mobile` at `C:\Users\PC\cadence-mobile` — HEAD eddbd51
- `chrispottergb/cadence-music-service` at `C:\Users\PC\cadence-music-service` — HEAD b939b4d
- Supabase project `rxoeyyiiwgnyjdtjouwy` (all migrations applied incl.
  `20260930000100_class_soundtracks.sql`). Railway service
  `https://music-service-production-5918.up.railway.app`.
- App id `com.cadencelabs.mobile`. Donor repos `C:\Users\PC\SovereignOS` and
  `C:\Users\PC\soverign` are READ ONLY; never reuse donor secrets/infra; no
  "qlltech"/QLL anything.

## Phase status

- Phase 3 Stage A (engine feasibility): ongoing on iPhone 16 Pro (iOS 26.6.1).
  NO permanent engine selected (media-player vs audio-graph vs hybrid).
  Android = PHYSICAL DEVICE UNVERIFIED.
- Stage B checkpoint delivered (engine-independent model, persistence, first
  Builder, global player). Timeline-editor feature work now PAUSED.
- NEXT TASK: implement the guided Class Builder UX in `guided-builder-brief.md`,
  then build for TestFlight and STOP for UX review.

## Where the code is

- Domain model: `src/soundtrack/model.ts` (+ `__tests__/model.test.ts`):
  ClassSoundtrack {tracks at explicit times, cues w/ type/priority/duck/repeat,
  sections}, toPlan(), positionAt(), addTrackAtFreeSpot(), laneRows(),
  parseSoundtrack(). Cue types map to bundled cue assets in CUE_TYPES.
- Engine-level timeline math/collision policy: `src/audiolab/timeline.ts`.
- Playback contract: `src/playback/engine.ts`; factory `src/playback/create.ts`;
  app-wide class player `src/playback/session.ts`; bar `src/playback/MiniPlayer.tsx`
  (mounted in `app/_layout.tsx`).
- Engines: `src/audiolab/playerEngine.ts` (expo-audio), `src/audiolab/graphEngine.ts`
  (react-native-audio-api; rolling decode window, generation guards).
- Persistence: `src/data/soundtracks.ts` (revision-checked saves).
- Current Builder (becomes Advanced Edit): `app/soundtracks/[id].tsx`; list
  `app/soundtracks/index.tsx`; entry from `app/(instructor)/library.tsx`.
- Audio Lab (dev test harness, guided tests + exports): `app/audio-lab.tsx`,
  `src/audiolab/guide.ts`, `metrics.ts`, `persist.ts`.

## Builds (TestFlight, Codemagic workflow "iOS TestFlight (internal)")

- 120: Builder + memory/transition instrumentation. 121: builder fixes + pinch
  zoom. 122 (processing): global class player / mini-player / lock screen.
- Build number = Codemagic counter + 100. Start builds in Codemagic: open the
  app page, JS-click "Start new build", then click the dialog's button via
  find() ref. Chrome extension connection drops often; the owner can start
  builds from their phone.

## Open evidence items (Stage A, parallel)

- Audio-graph JS memory 16.8 -> 125.8 MB over 21 min: unresolved. Note
  Hermes js_heapSize is capacity; heartbeat now records allocatedBytes/numGCs
  and engine resources; "lean logging" A/B switch in the lab.
- Media-player song-change stall 165/189 ms: unresolved; build 120+ records
  segment_audible / segment_tail.
- Still needed: untouched locked 30/45-min runs per engine, real call with
  telemetry, Bluetooth, link expiry (90 s test option), network loss.

## Working rules the owner set

- Report raw numbers, no adjectives; never present emulator/tests as device
  results; tester observations do not replace telemetry.
- Don't spend musicapi credits for testing. Gym "Red dragon" allowance: 16
  (6 used), period ends 2026-10-01; October not set.
- Keep CI green, logical commits, never commit secrets. On Windows, regenerate
  package-lock on Linux (docker node:22) after adding deps.
