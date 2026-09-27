/**
 * Class timeline math, independent of any audio library.
 *
 * The TIMELINE is authoritative. A track's position comes from where it is
 * placed and its ACTUAL rendered duration (a 60 s request that came back at
 * 54.8 s occupies 54.8 s); nothing is stretched, looped or trimmed unless a
 * rule on the segment says so explicitly.
 */

export type CuePriority = 'high' | 'normal' | 'low';

export interface TimelineTrack {
  /** Stable id of the generated track this segment plays. */
  trackId: string;
  /** Actual rendered length of the source audio, seconds. */
  sourceDurationSeconds: number;
  /** Where in the source to begin, seconds (explicit trim-in). */
  sourceOffsetSeconds?: number;
  /** Explicit trim-out: play at most this long. Omit to play to the end. */
  maxDurationSeconds?: number;
  gain?: number;
  /** Overlap with the PREVIOUS segment. 0 = butt-joined. */
  crossfadeInSeconds?: number;
}

export interface CueSpec {
  id: string;
  /** Absolute class time, or the first occurrence of a recurring cue. */
  timeSeconds: number;
  assetId: string;
  /** Audible length of the cue asset, used for ducking and collisions. */
  assetDurationSeconds: number;
  priority: CuePriority;
  /** Music level while this cue plays, 0..1 of the master level. */
  duckTo?: number;
  /** Repeat every N seconds until repeatUntilSeconds (inclusive). */
  repeatEverySeconds?: number;
  repeatUntilSeconds?: number;
}

export interface PlacedTrack {
  index: number;
  trackId: string;
  startSeconds: number;
  endSeconds: number;
  sourceOffsetSeconds: number;
  playSeconds: number;
  gain: number;
  crossfadeInSeconds: number;
  crossfadeOutSeconds: number;
}

export interface CueEvent {
  /** Unique per occurrence: `${cueId}@${time}`. */
  key: string;
  cueId: string;
  timeSeconds: number;
  assetId: string;
  durationSeconds: number;
  priority: CuePriority;
  duckTo: number;
}

const RANK: Record<CuePriority, number> = { high: 0, normal: 1, low: 2 };
const EPS = 1e-6;

/** Lay tracks end to end, honouring explicit trims and crossfades. */
export function placeTracks(tracks: TimelineTrack[]): PlacedTrack[] {
  const out: PlacedTrack[] = [];
  let cursor = 0;
  tracks.forEach((t, index) => {
    if (!(t.sourceDurationSeconds > 0)) throw new Error(`track ${t.trackId} has no rendered duration`);
    const offset = Math.max(0, t.sourceOffsetSeconds ?? 0);
    if (offset >= t.sourceDurationSeconds) throw new Error(`track ${t.trackId} offset is past its end`);
    const available = t.sourceDurationSeconds - offset;
    const playSeconds = t.maxDurationSeconds !== undefined ? Math.min(available, t.maxDurationSeconds) : available;
    const prev = out[out.length - 1];
    const wantFade = index === 0 ? 0 : Math.max(0, t.crossfadeInSeconds ?? 0);
    // A crossfade can never be longer than either side of it.
    const fade = prev ? Math.min(wantFade, prev.playSeconds / 2, playSeconds / 2) : 0;
    const start = Math.max(0, cursor - fade);
    if (prev) prev.crossfadeOutSeconds = fade;
    out.push({
      index,
      trackId: t.trackId,
      startSeconds: start,
      endSeconds: start + playSeconds,
      sourceOffsetSeconds: offset,
      playSeconds,
      gain: t.gain ?? 1,
      crossfadeInSeconds: fade,
      crossfadeOutSeconds: 0,
    });
    cursor = start + playSeconds;
  });
  return out;
}

export function totalDuration(placed: PlacedTrack[]): number {
  return placed.length ? placed[placed.length - 1]!.endSeconds : 0;
}

/** Which placed track(s) sound at a class time (two during a crossfade). */
export function tracksAt(placed: PlacedTrack[], t: number): PlacedTrack[] {
  return placed.filter((p) => t + EPS >= p.startSeconds && t < p.endSeconds - EPS);
}

/** Expand recurring cues into concrete events, sorted by time then priority. */
export function expandCues(specs: CueSpec[], classDurationSeconds: number): CueEvent[] {
  const events: CueEvent[] = [];
  for (const c of specs) {
    const times: number[] = [];
    if (c.repeatEverySeconds && c.repeatEverySeconds > 0) {
      const until = Math.min(c.repeatUntilSeconds ?? classDurationSeconds, classDurationSeconds);
      for (let t = c.timeSeconds; t <= until + EPS; t += c.repeatEverySeconds) times.push(Math.round(t * 1000) / 1000);
    } else if (c.timeSeconds <= classDurationSeconds + EPS) {
      times.push(c.timeSeconds);
    }
    for (const t of times) {
      events.push({
        key: `${c.id}@${t}`,
        cueId: c.id,
        timeSeconds: t,
        assetId: c.assetId,
        durationSeconds: c.assetDurationSeconds,
        priority: c.priority,
        duckTo: c.duckTo ?? 0.3,
      });
    }
  }
  return events.sort((a, b) => a.timeSeconds - b.timeSeconds || RANK[a.priority] - RANK[b.priority]);
}

export interface Resolution {
  play: CueEvent[];
  dropped: { event: CueEvent; reason: 'collision' }[];
  deferred: { event: CueEvent; fromSeconds: number }[];
}

/**
 * Collision policy, so simultaneous speech is never unintelligible:
 *  - Cues never overlap. Walk in time order, keeping the end of the last
 *    scheduled cue.
 *  - A cue that would overlap a HIGHER priority cue: normal priority is
 *    deferred to start right after it (if that is within maxDeferSeconds);
 *    low priority is dropped; high priority is never dropped.
 *  - Two HIGH cues that overlap: the later one waits for the earlier one.
 *  - A higher priority cue arriving while a LOWER priority cue is scheduled:
 *    the lower one is removed (dropped) and the higher one keeps its time.
 */
export function resolveCollisions(events: CueEvent[], maxDeferSeconds = 3): Resolution {
  const play: CueEvent[] = [];
  const dropped: Resolution['dropped'] = [];
  const deferred: Resolution['deferred'] = [];
  for (const e of events) {
    const last = play[play.length - 1];
    const lastEnd = last ? last.timeSeconds + last.durationSeconds : -Infinity;
    if (!last || e.timeSeconds >= lastEnd - EPS) {
      play.push(e);
      continue;
    }
    // Overlap with `last`.
    if (RANK[e.priority] < RANK[last.priority]) {
      // Newcomer outranks the scheduled cue: the scheduled one yields.
      play.pop();
      dropped.push({ event: last, reason: 'collision' });
      const before = play[play.length - 1];
      const beforeEnd = before ? before.timeSeconds + before.durationSeconds : -Infinity;
      if (e.timeSeconds >= beforeEnd - EPS) play.push(e);
      else {
        const moved = { ...e, timeSeconds: beforeEnd };
        deferred.push({ event: moved, fromSeconds: e.timeSeconds });
        play.push(moved);
      }
      continue;
    }
    if (e.priority === 'low') {
      dropped.push({ event: e, reason: 'collision' });
      continue;
    }
    const wait = lastEnd - e.timeSeconds;
    if (e.priority === 'high' || wait <= maxDeferSeconds + EPS) {
      const moved = { ...e, timeSeconds: lastEnd };
      deferred.push({ event: moved, fromSeconds: e.timeSeconds });
      play.push(moved);
    } else {
      dropped.push({ event: e, reason: 'collision' });
    }
  }
  return { play, dropped, deferred };
}

/**
 * Seek policy: after seeking to `position`, cues strictly before it are
 * skipped and never replayed; a cue AT the position plays. A cue whose
 * speech would already be in progress is skipped rather than started
 * mid-word.
 */
export function pendingAfterSeek(events: CueEvent[], position: number, alreadyFired: ReadonlySet<string>): CueEvent[] {
  return events.filter((e) => e.timeSeconds + EPS >= position && !alreadyFired.has(e.key));
}

export function nextCue(events: CueEvent[], position: number, fired: ReadonlySet<string>): CueEvent | null {
  return pendingAfterSeek(events, position, fired)[0] ?? null;
}

export function formatClock(seconds: number): string {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${String(m).padStart(2, '0')}:${r.toFixed(1).padStart(4, '0')}`;
}
