# Phase 4 — instructor class creation

Implemented locally on `feat/instructor-class-builder`, based on
`f122b5a24452c7823f1bbcd06fe9d4976451cdfc`. The owner explicitly authorized
application-code work after the earlier Build 123 review hold. No TestFlight
build has been produced from these changes.

## Instructor experience

Create Class now opens four steps: My class, Timing, Cues, Music. Instructors
choose length, purpose, warm-up/cooldown, optional work/rest rounds, cue scope
and intervals, custom spoken text, and library or generated music. Generation
accepts style, target BPM, instrumental, sung, rap or chant, and optional song
lyrics. Coaching text is separate from lyrics. Preview uses the existing
section editor, save, start, and Advanced Edit paths. Saved classes can be
duplicated; the original is retained. Music-only mode preserves cue definitions.

Library music uses the selected order. Repetition requires an explicit choice;
quiet time and clipped section endings remain visible. Rounds exclude a final
rest and any remaining main-section time is described as continuous practice.

## Implementation

- `src/builder/InstructorBuilder.tsx`: instructor screens and account/gym-scoped
  local drafts. Drafts clear after successful save.
- `src/soundtrack/instructor.ts`: proposal, validation, library assembly and
  capability-aware service requests.
- `src/music/classGeneration.ts`: durable request intent and idempotency key
  before submission; persisted job IDs, actual track durations, partial results,
  resume, and a 40-request safety limit. The UI explicitly describes allowance
  use; this backend does not expose the remaining allowance here.
- Existing JSON documents retain schema version 1. New optional fields store
  instructor metadata, whole-class cues, work-round intervals, cue mode and
  spoken text. Existing saved classes and Advanced Edit detection remain intact.
- `expo-speech` plays custom text through the class media player. Ducking ends
  on speech completion. Pause, seek, stop and disposal cancel speech and stale
  callbacks. A subsequent scheduled cue interrupts an unfinished cue; preview
  reports collisions predicted by the timeline. The graph engine is unchanged
  and cannot play spoken class instructions; this is not a permanent engine decision.
- The media player now advances through quiet sections to the full class end.
  Saved tracks outside the recent library are resolved through the same
  authorized playback endpoint.

## Validation and release

Local lint, TypeScript, and 106 Jest tests pass. Added coverage exercises the
instructor-to-save/start flow, draft restore, duplication, legacy persistence,
cue placement, music-only mode, real speech dispatch/cancellation, quiet time,
capability limits, lost responses, stored-job recovery and failed local storage.
Generation and speech use mocks in tests; no paid music was generated.
The iOS JavaScript/Hermes bundle exports successfully (1,805 modules).
The dependency lock was regenerated in Ubuntu with Node 22.14.0, and Linux
`npm ci --dry-run --ignore-scripts` passed. All existing dependency versions
are preserved; `expo-speech` is the only added package.

The new native speech dependency requires a new native build. Build 123 does not
contain this implementation. iPhone installation, audible TTS/ducking, mute
switch, Bluetooth, phone interruptions, background/lock-screen operation,
generation against the live service, and the two-minute instructor UX run remain
unverified. Runtime-generated speech has platform/session limitations; validate
it on the actual device before teaching with it. Validation above was performed
locally before pushing; no native archive or TestFlight upload was performed.

Generation pauses when leaving the screen; already-submitted service jobs may
finish. Returning resumes that same intent. Failed jobs retain completed music
and offer the detailed editor rather than silently creating another paid job.
Small tails below the timeline's three-second minimum clip remain visible as
quiet time and do not cause another paid request.
