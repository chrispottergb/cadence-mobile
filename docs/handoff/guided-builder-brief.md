# Guided Class Builder — product-owner brief (2026-09-28)

Status: AUTHORIZED, NOT STARTED. Additional timeline-editor feature work is PAUSED.
Keep the Stage B timeline architecture intact; this is a UX redesign, not a
model change.

## Core principle

The instructor describes the CLASS; Cadence constructs the AUDIO TIMELINE.
The existing timeline editor becomes "Advanced Edit" (kept, not deleted).

## Guided flow

1. CLASS — name + length chips: 30 / 45 / 60 / 75 / 90 / Custom. Continue.
   No music, timestamps, cues or technical settings here.
2. SECTIONS — "How is this class structured?" Large cards: Warm-up, Technique,
   Drilling, Rounds, Conditioning, Cooldown, Custom. Each added section gets a
   duration stepper ([-] 10 MIN [+]). Show "Total: 60 / 60 minutes" and a clear
   duration bar. Cadence computes starts/ends. Reorder with large controls or
   drag handles. Optional templates (convenience only, fully editable, NOT
   hard-coded methodology in the domain model):
   - Standard 60: Warm-up 10, Technique 15, Drilling 15, Rounds 15, Cooldown 5
   - Open Mat, Kids Class, Competition Training, Conditioning, Custom
3. MUSIC — per section card: duration, [Choose Music], Intensity slider
   (LOW..HIGH). Choosing music auto-places tracks inside the section. If music
   doesn't fill the section, say so and offer: Add another song / Repeat music /
   Leave remainder quiet. Never silently stretch audio. Picker: preview play,
   choose, duration, descriptive info, and a prominent
   "GENERATE MUSIC FOR THIS SECTION" that carries section context (type,
   intensity, duration, style). No new AI-generation logic in this pass unless
   already supported — just make the path obvious.
4. CUES — contextual to a section: "+ Add cue" -> large options: Round start,
   Round end, 30 seconds, Switch partners, Rotate, Rest, Custom. Instructor-
   friendly timing, e.g. Rounds: every [3 min], rest [1 min], repeat [5 rounds];
   Cadence computes the events (no manual 00:18:00 etc. outside Advanced Edit).
   Allow custom cue name, optional existing cue audio, timing, repeat, and
   priority where appropriate — but hide "priority" jargon (translate to plain
   language).
5. PREVIEW / OVERVIEW — clean summary per section (minutes, songs, cues) with
   ▶ Preview class, Save class, Advanced edit.

## Class-running view (new)

Not a DAW. Big, high-contrast, glove-friendly, readable from several feet:
section name, time remaining in section, current track, next cue + countdown,
[PAUSE], [◀ 30 SEC] [+30 SEC ▶], next section.

## Usability target

A first-time instructor builds a basic 60-minute class in ~2 minutes without
instruction. Never expose: audio timelines, DAWs, source offsets, audio
nodes, engines, absolute timestamps, signed URLs, generation jobs.

## Must preserve

ClassTimeline domain architecture, engine abstraction (src/playback), gym
ownership, RLS, class_soundtracks persistence, cue priority model, ducking,
playback-generation guards, global player (src/playback/session.ts +
MiniPlayer), lock-screen integration, generation infrastructure.

## Test at minimum

Create 60-min class from scratch; from template; change section durations;
reorder sections; choose music per section; add a section cue; configure
repeating round cues; preview; save; reopen; Advanced Edit; start class
(running view); leave Builder; return during playback.

## Then

Provide screenshots or a TestFlight build for product-owner UX review, and
STOP for UX review. Do not begin unrelated features.
