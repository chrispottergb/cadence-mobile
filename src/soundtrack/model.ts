/**
 * Class Soundtrack domain model (Phase 3 Stage B).
 *
 * "Build the soundtrack around the class, not the class around a playlist."
 *
 * A ClassSoundtrack is the authoritative description of class time: where
 * each piece of music sits, which part of the source it plays, when cues
 * fire and how the class is organised into sections. It knows nothing about
 * any audio library. `toPlan` turns it into the neutral plan (placed tracks
 * + resolved cue events) that any PlaybackEngine can play.
 *
 * Durations: a track's usable length is its ACTUAL stored duration
 * (`assetDurationSeconds`), never the length that was requested from the
 * generator. Nothing is stretched or looped; trims are explicit.
 */
import { type CueEvent, type CuePriority, expandCues, type PlacedTrack, resolveCollisions } from '@/audiolab/timeline';

export const SCHEMA_VERSION = 1;
export const MIN_TRACK_SECONDS = 1;
export const MAX_CLASS_SECONDS = 4 * 3600;

export interface SoundtrackTrack {
  id: string;
  /** Cadence generated-track id (authorized playback is resolved by id). */
  assetId: string;
  label: string;
  /** Actual stored length of the asset, seconds. Authoritative. */
  assetDurationSeconds: number;
  /** Class time at which this track begins. */
  startSeconds: number;
  /** Where in the asset to begin (trim-in). */
  sourceOffsetSeconds: number;
  /** How long it plays (trim-out); never beyond the asset. */
  durationSeconds: number;
  /** Relative level of this track, 0..1. */
  gain: number;
  fadeInSeconds: number;
  fadeOutSeconds: number;
}

/**
 * Cue types are organisational, not a fixed methodology; each maps to a
 * sound and a default priority that the instructor can override.
 */
export type CueType = 'round_start' | 'round_end' | 'stop' | 'switch' | 'countdown' | 'coaching' | 'motivation';

export interface SoundtrackCue {
  id: string;
  timeSeconds: number;
  type: CueType;
  priority: CuePriority;
  /** Music level while this cue plays, 0..1 of the current music level. */
  duckTo: number;
  label?: string;
  /** Optional repeat: every N seconds until `repeatUntilSeconds` (or class end). */
  repeatEverySeconds?: number;
  repeatUntilSeconds?: number;
}

/** Instructor-defined label over a span of class time. Organisational only. */
export interface SoundtrackSection {
  id: string;
  label: string;
  startSeconds: number;
  endSeconds: number;
}

export interface ClassSoundtrack {
  schemaVersion: number;
  name: string;
  durationSeconds: number;
  /** Instructor-selected music level for the whole class, 0..1. */
  musicGain: number;
  tracks: SoundtrackTrack[];
  cues: SoundtrackCue[];
  sections: SoundtrackSection[];
  /**
   * The Guided Builder's description of the class (owned and validated by
   * `src/soundtrack/guided.ts`). Opaque here: the timeline above stays the
   * authoritative description of class time and playback never reads this.
   */
  guide?: Record<string, unknown>;
}

/** Default sound and priority for each cue type (bundled Stage A cue assets). */
export const CUE_TYPES: Record<CueType, { label: string; assetId: string; priority: CuePriority; duckTo: number }> = {
  round_start: { label: 'Round start', assetId: 'round', priority: 'high', duckTo: 0.3 },
  round_end: { label: 'Round end (bell)', assetId: 'bell', priority: 'high', duckTo: 0.3 },
  stop: { label: 'Stop', assetId: 'stop', priority: 'high', duckTo: 0.2 },
  switch: { label: 'Switch / rotate', assetId: 'switch', priority: 'normal', duckTo: 0.3 },
  countdown: { label: '30 seconds left', assetId: 'thirty', priority: 'normal', duckTo: 0.3 },
  coaching: { label: 'Coaching reminder', assetId: 'switch', priority: 'normal', duckTo: 0.4 },
  motivation: { label: 'Motivation', assetId: 'bell', priority: 'low', duckTo: 0.5 },
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round3 = (v: number) => Math.round(v * 1000) / 1000;
let seq = 0;
export const newId = (prefix: string) => `${prefix}_${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function newSoundtrack(name: string, durationSeconds: number): ClassSoundtrack {
  return {
    schemaVersion: SCHEMA_VERSION,
    name: name.trim() || 'Untitled class',
    durationSeconds: clamp(Math.round(durationSeconds), 60, MAX_CLASS_SECONDS),
    musicGain: 1,
    tracks: [],
    cues: [],
    sections: [],
  };
}

/** Keep a track inside its asset and inside the class; never stretch. */
export function normalizeTrack(t: SoundtrackTrack, classSeconds: number): SoundtrackTrack {
  const asset = Math.max(0, t.assetDurationSeconds);
  const offset = clamp(t.sourceOffsetSeconds, 0, Math.max(0, asset - MIN_TRACK_SECONDS));
  const start = clamp(t.startSeconds, 0, Math.max(0, classSeconds - MIN_TRACK_SECONDS));
  const duration = clamp(t.durationSeconds, MIN_TRACK_SECONDS, Math.max(MIN_TRACK_SECONDS, asset - offset));
  const half = duration / 2;
  return {
    ...t,
    startSeconds: round3(start),
    sourceOffsetSeconds: round3(offset),
    durationSeconds: round3(duration),
    gain: clamp(t.gain, 0, 1),
    fadeInSeconds: round3(clamp(t.fadeInSeconds, 0, half)),
    fadeOutSeconds: round3(clamp(t.fadeOutSeconds, 0, half)),
  };
}

export const trackEnd = (t: SoundtrackTrack) => t.startSeconds + t.durationSeconds;
export const sortedTracks = (s: ClassSoundtrack) => [...s.tracks].sort((a, b) => a.startSeconds - b.startSeconds || a.id.localeCompare(b.id));
export const sortedCues = (s: ClassSoundtrack) => [...s.cues].sort((a, b) => a.timeSeconds - b.timeSeconds || a.id.localeCompare(b.id));

export interface AssetRef {
  assetId: string;
  label: string;
  durationSeconds: number;
}

/** Add a track starting at `atSeconds` (the whole asset, trimmed only by the class end). */
export function addTrack(s: ClassSoundtrack, asset: AssetRef, atSeconds: number): ClassSoundtrack {
  if (!(asset.durationSeconds > 0)) throw new Error('asset has no stored duration');
  const t = normalizeTrack(
    {
      id: newId('trk'),
      assetId: asset.assetId,
      label: asset.label,
      assetDurationSeconds: asset.durationSeconds,
      startSeconds: atSeconds,
      sourceOffsetSeconds: 0,
      durationSeconds: asset.durationSeconds,
      gain: 1,
      fadeInSeconds: 0,
      fadeOutSeconds: 0,
    },
    s.durationSeconds,
  );
  return { ...s, tracks: [...s.tracks, t] };
}

/**
 * "+ Music here": start at the cursor, but never on top of music that is
 * already playing there. If a track covers the cursor, the new one starts
 * where that track ends (repeated until the spot is free). Builder feedback,
 * build 120: adding twice at 0:00 stacked two songs at full volume.
 */
export function addTrackAtFreeSpot(s: ClassSoundtrack, asset: AssetRef, atSeconds: number): ClassSoundtrack {
  let start = Math.max(0, atSeconds);
  for (let guard = 0; guard < 100; guard++) {
    const covering = s.tracks.filter((t) => t.startSeconds <= start + 1e-6 && trackEnd(t) > start + 1e-6);
    if (!covering.length) break;
    start = Math.max(...covering.map(trackEnd));
  }
  return addTrack(s, asset, start);
}

/** Lane rows so overlapping tracks are drawn on separate rows (display only). */
export function laneRows(tracks: SoundtrackTrack[]): Map<string, number> {
  const rows: number[] = []; // end time per row
  const out = new Map<string, number>();
  for (const t of [...tracks].sort((a, b) => a.startSeconds - b.startSeconds)) {
    let r = rows.findIndex((end) => end <= t.startSeconds + 1e-6);
    if (r < 0) {
      r = rows.length;
      rows.push(0);
    }
    rows[r] = trackEnd(t);
    out.set(t.id, r);
  }
  return out;
}

/** Append after the last track (butt-joined). */
export function appendTrack(s: ClassSoundtrack, asset: AssetRef): ClassSoundtrack {
  const last = sortedTracks(s).at(-1);
  return addTrack(s, asset, last ? trackEnd(last) : 0);
}

export function updateTrack(s: ClassSoundtrack, id: string, patch: Partial<Omit<SoundtrackTrack, 'id' | 'assetId' | 'assetDurationSeconds'>>): ClassSoundtrack {
  return { ...s, tracks: s.tracks.map((t) => (t.id === id ? normalizeTrack({ ...t, ...patch }, s.durationSeconds) : t)) };
}

export const removeTrack = (s: ClassSoundtrack, id: string): ClassSoundtrack => ({ ...s, tracks: s.tracks.filter((t) => t.id !== id) });

/**
 * Move a track one place earlier/later in the running order and repack the
 * two affected tracks back-to-back from the earlier one's start. Other
 * tracks keep their times.
 */
export function reorderTrack(s: ClassSoundtrack, id: string, dir: -1 | 1): ClassSoundtrack {
  const order = sortedTracks(s);
  const i = order.findIndex((t) => t.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= order.length) return s;
  const [a, b] = i < j ? [order[i]!, order[j]!] : [order[j]!, order[i]!];
  const start = a.startSeconds;
  const first = { ...b, startSeconds: start };
  const second = { ...a, startSeconds: start + b.durationSeconds };
  const map = new Map([first, second].map((t) => [t.id, normalizeTrack(t, s.durationSeconds)]));
  return { ...s, tracks: s.tracks.map((t) => map.get(t.id) ?? t) };
}

/** Pack every track back-to-back in its current order, from class time 0. */
export function packTracks(s: ClassSoundtrack): ClassSoundtrack {
  let cursor = 0;
  const packed = sortedTracks(s).map((t) => {
    const out = normalizeTrack({ ...t, startSeconds: cursor }, s.durationSeconds);
    cursor = trackEnd(out);
    return out;
  });
  return { ...s, tracks: packed };
}

export function addCue(s: ClassSoundtrack, type: CueType, atSeconds: number, extra: Partial<SoundtrackCue> = {}): ClassSoundtrack {
  const d = CUE_TYPES[type];
  const cue: SoundtrackCue = {
    id: newId('cue'),
    type,
    timeSeconds: round3(clamp(atSeconds, 0, s.durationSeconds)),
    priority: d.priority,
    duckTo: d.duckTo,
    ...extra,
  };
  return { ...s, cues: [...s.cues, cue] };
}

export function updateCue(s: ClassSoundtrack, id: string, patch: Partial<Omit<SoundtrackCue, 'id'>>): ClassSoundtrack {
  return {
    ...s,
    cues: s.cues.map((c) => {
      if (c.id !== id) return c;
      const next = { ...c, ...patch };
      next.timeSeconds = round3(clamp(next.timeSeconds, 0, s.durationSeconds));
      next.duckTo = clamp(next.duckTo, 0, 1);
      if (next.repeatEverySeconds !== undefined && !(next.repeatEverySeconds >= 5)) delete next.repeatEverySeconds;
      return next;
    }),
  };
}

export const removeCue = (s: ClassSoundtrack, id: string): ClassSoundtrack => ({ ...s, cues: s.cues.filter((c) => c.id !== id) });

export function addSection(s: ClassSoundtrack, label: string, startSeconds: number, endSeconds: number): ClassSoundtrack {
  const start = clamp(startSeconds, 0, s.durationSeconds);
  const end = clamp(Math.max(endSeconds, start + 1), start + 1, s.durationSeconds);
  return { ...s, sections: [...s.sections, { id: newId('sec'), label: label.trim() || 'Section', startSeconds: round3(start), endSeconds: round3(end) }] };
}

export function updateSection(s: ClassSoundtrack, id: string, patch: Partial<Omit<SoundtrackSection, 'id'>>): ClassSoundtrack {
  return {
    ...s,
    sections: s.sections.map((x) => {
      if (x.id !== id) return x;
      const n = { ...x, ...patch };
      n.startSeconds = round3(clamp(n.startSeconds, 0, s.durationSeconds - 1));
      n.endSeconds = round3(clamp(n.endSeconds, n.startSeconds + 1, s.durationSeconds));
      return n;
    }),
  };
}

export const removeSection = (s: ClassSoundtrack, id: string): ClassSoundtrack => ({ ...s, sections: s.sections.filter((x) => x.id !== id) });

/** The section a class time falls in (latest-starting one wins if sections overlap). */
export function sectionAt(s: ClassSoundtrack, t: number): SoundtrackSection | null {
  const hits = s.sections.filter((x) => t >= x.startSeconds && t < x.endSeconds);
  return hits.sort((a, b) => b.startSeconds - a.startSeconds)[0] ?? null;
}

/** Changing the class length keeps everything inside the new length. */
export function setDuration(s: ClassSoundtrack, seconds: number): ClassSoundtrack {
  const d = clamp(Math.round(seconds), 60, MAX_CLASS_SECONDS);
  const next = { ...s, durationSeconds: d };
  return {
    ...next,
    tracks: s.tracks
      .filter((t) => t.startSeconds < d - MIN_TRACK_SECONDS)
      .map((t) => normalizeTrack({ ...t, durationSeconds: Math.min(t.durationSeconds, d - t.startSeconds) }, d)),
    cues: s.cues.filter((c) => c.timeSeconds <= d),
    sections: s.sections.filter((x) => x.startSeconds < d - 1).map((x) => ({ ...x, endSeconds: Math.min(x.endSeconds, d) })),
  };
}

/** Warnings the Builder shows; they never block saving. */
export interface Issue {
  kind: 'overlap' | 'gap' | 'past_end';
  at: number;
  detail: string;
}

export function issues(s: ClassSoundtrack): Issue[] {
  const out: Issue[] = [];
  const order = sortedTracks(s);
  for (let i = 1; i < order.length; i++) {
    const prev = order[i - 1]!;
    const cur = order[i]!;
    const gap = cur.startSeconds - trackEnd(prev);
    const fade = Math.min(prev.fadeOutSeconds, cur.fadeInSeconds);
    if (gap < -0.001 && -gap > fade + 0.001) out.push({ kind: 'overlap', at: cur.startSeconds, detail: `${prev.label} and ${cur.label} overlap by ${(-gap).toFixed(1)} s` });
    if (gap > 1) out.push({ kind: 'gap', at: trackEnd(prev), detail: `${gap.toFixed(1)} s of silence before ${cur.label}` });
  }
  for (const t of order) if (trackEnd(t) > s.durationSeconds + 0.001) out.push({ kind: 'past_end', at: t.startSeconds, detail: `${t.label} runs past the class end` });
  return out;
}

/** The neutral plan any PlaybackEngine plays. */
export interface PlaybackPlan {
  placed: PlacedTrack[];
  cues: CueEvent[];
  droppedCueKeys: string[];
  deferredCueKeys: string[];
  totalSeconds: number;
}

export function toPlan(s: ClassSoundtrack, cueSeconds: (assetId: string) => number): PlaybackPlan {
  const order = sortedTracks(s).map((t) => normalizeTrack(t, s.durationSeconds));
  const placed: PlacedTrack[] = order.map((t, index) => ({
    index,
    trackId: t.assetId,
    startSeconds: t.startSeconds,
    endSeconds: round3(t.startSeconds + t.durationSeconds),
    sourceOffsetSeconds: t.sourceOffsetSeconds,
    playSeconds: t.durationSeconds,
    gain: t.gain * s.musicGain,
    crossfadeInSeconds: t.fadeInSeconds,
    crossfadeOutSeconds: t.fadeOutSeconds,
  }));
  const specs = sortedCues(s).map((c) => {
    const d = CUE_TYPES[c.type];
    return {
      id: c.id,
      timeSeconds: c.timeSeconds,
      assetId: d.assetId,
      assetDurationSeconds: cueSeconds(d.assetId),
      priority: c.priority,
      duckTo: c.duckTo,
      ...(c.repeatEverySeconds ? { repeatEverySeconds: c.repeatEverySeconds, repeatUntilSeconds: c.repeatUntilSeconds ?? s.durationSeconds } : {}),
    };
  });
  const resolved = resolveCollisions(expandCues(specs, s.durationSeconds));
  return {
    placed,
    cues: resolved.play,
    droppedCueKeys: resolved.dropped.map((d) => d.event.key),
    deferredCueKeys: resolved.deferred.map((d) => d.event.key),
    totalSeconds: s.durationSeconds,
  };
}

/** Where the class stands at time t: what sounds, from where in each source, and what comes next. */
export interface Position {
  active: { trackId: string; index: number; sourceSeconds: number }[];
  nextCue: CueEvent | null;
  skippedCueKeys: string[];
}

export function positionAt(plan: PlaybackPlan, t: number): Position {
  const active = plan.placed
    .filter((p) => t >= p.startSeconds && t < p.endSeconds)
    .map((p) => ({ trackId: p.trackId, index: p.index, sourceSeconds: round3(p.sourceOffsetSeconds + (t - p.startSeconds)) }));
  const skipped = plan.cues.filter((c) => c.timeSeconds < t - 1e-6).map((c) => c.key);
  const nextCue = plan.cues.find((c) => c.timeSeconds >= t - 1e-6) ?? null;
  return { active, nextCue, skippedCueKeys: skipped };
}

/** Validate a stored document. Unknown or broken data is rejected, never guessed. */
export function parseSoundtrack(raw: unknown): { ok: true; value: ClassSoundtrack } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'not an object' };
  const r = raw as Partial<ClassSoundtrack>;
  if (r.schemaVersion !== SCHEMA_VERSION) return { ok: false, error: `unsupported schema version ${String(r.schemaVersion)}` };
  if (typeof r.name !== 'string' || typeof r.durationSeconds !== 'number' || !(r.durationSeconds > 0)) return { ok: false, error: 'missing name or duration' };
  if (!Array.isArray(r.tracks) || !Array.isArray(r.cues) || !Array.isArray(r.sections)) return { ok: false, error: 'missing tracks, cues or sections' };
  for (const t of r.tracks) {
    if (typeof t?.id !== 'string' || typeof t.assetId !== 'string' || !(t.assetDurationSeconds > 0)) return { ok: false, error: 'invalid track' };
  }
  for (const c of r.cues) {
    if (typeof c?.id !== 'string' || !(c.type in CUE_TYPES) || typeof c.timeSeconds !== 'number') return { ok: false, error: 'invalid cue' };
  }
  const value: ClassSoundtrack = {
    schemaVersion: SCHEMA_VERSION,
    name: r.name,
    durationSeconds: r.durationSeconds,
    musicGain: typeof r.musicGain === 'number' ? clamp(r.musicGain, 0, 1) : 1,
    tracks: r.tracks.map((t) => normalizeTrack(t, r.durationSeconds!)),
    cues: r.cues,
    sections: r.sections.filter((x) => typeof x?.id === 'string' && x.endSeconds > x.startSeconds),
    ...(r.guide && typeof r.guide === 'object' && !Array.isArray(r.guide) ? { guide: r.guide } : {}),
  };
  return { ok: true, value };
}
