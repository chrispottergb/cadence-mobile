import { type AudioPlayer, createAudioPlayer, setAudioModeAsync } from 'expo-audio';

import type { CueAsset, EngineSnapshot, EngineState, LabEngine, LoadedTrack } from './engine';
import { record } from './metrics';
import { type CueEvent, pendingAfterSeek, type PlacedTrack, totalDuration, tracksAt } from './timeline';

/**
 * Candidate 2: native media players (expo-audio).
 *
 * One player per track segment, extra players for cues. expo-audio has no
 * audio-clock scheduling, so class time is read from the active player's
 * position and a JavaScript loop (TICK_MS) starts the next track, cues,
 * crossfade ramps and ducking. Overlap is real (two players sounding), but
 * every timed action inherits the loop's jitter; each cue records exactly
 * how late it fired against the player clock.
 */
const TICK_MS = 20;
const DUCK_ATTACK_MS = 250;
const DUCK_RELEASE_MS = 600;
/**
 * Load the next segment's player this far ahead of its start. Stage A,
 * build 116, iPhone 16 Pro: creating the player at the boundary stalled the
 * class clock ~1.3 s (audible gap) at the song 2 -> 3 change.
 */
const PRELOAD_SECONDS = 6;

export class PlayerEngine implements LabEngine {
  readonly name = 'media-player';
  private placed: PlacedTrack[] = [];
  private cues: CueEvent[] = [];
  private players = new Map<number, AudioPlayer>();
  private sources = new Map<string, string>();
  private cuePlayers = new Map<string, AudioPlayer>();
  private fired = new Set<string>();
  private state: EngineState = 'IDLE';
  private lastError: string | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  /** Class time = baseClass + (player.currentTime - baseSource) of the reference segment. */
  private ref: { index: number; baseClass: number; baseSource: number } | null = null;
  private pausedAt = 0;
  private duck = { level: 1, target: 1, t0: 0, from: 1, ms: 0 };
  private started = new Set<number>();
  private preloaded = new Set<number>();
  /**
   * Stage A, build 117: position was read from the player before iOS applied
   * seekTo, so for one tick the class clock read the old place (a stray
   * 30 ms blip of the previous song after a +60 s, and "resume actual 0").
   * Until the player confirms the seek, the clock holds at the target.
   */
  private seekPendingSince: number | null = null;
  /** Stage A, build 117 T3: iOS stopped the player; the engine kept reporting PLAYING. */
  private lastPlayingSeen = 0;

  constructor(private readonly onChange: () => void = () => {}) {}

  private set(s: EngineState) {
    this.state = s;
    record(this.name, 'state', { state: s, position: Number(this.position().toFixed(3)) });
    this.onChange();
  }

  async load(placed: PlacedTrack[], tracks: LoadedTrack[], cues: CueEvent[], assets: CueAsset[]): Promise<void> {
    this.set('LOADING');
    const t0 = Date.now();
    try {
      await setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true, interruptionMode: 'doNotMix' });
      this.placed = placed;
      this.cues = cues;
      for (const t of tracks) this.sources.set(t.trackId, t.source);
      for (const a of assets) this.cuePlayers.set(a.assetId, createAudioPlayer({ uri: a.source }));
      record(this.name, 'loaded', { ms: Date.now() - t0, tracks: tracks.length, cues: cues.length });
      this.set('READY');
    } catch (e) {
      this.fail(e);
    }
  }

  private fail(e: unknown) {
    this.lastError = e instanceof Error ? e.message : String(e);
    record(this.name, 'error', { message: this.lastError });
    this.set('ERROR');
  }

  private player(index: number): AudioPlayer {
    let p = this.players.get(index);
    if (!p) {
      const seg = this.placed[index]!;
      p = createAudioPlayer({ uri: this.sources.get(seg.trackId)! });
      this.players.set(index, p);
    }
    return p;
  }

  private position(): number {
    if (this.state !== 'PLAYING' || !this.ref) return this.pausedAt;
    const p = this.players.get(this.ref.index);
    if (!p) return this.pausedAt;
    if (this.seekPendingSince !== null) {
      const applied = Math.abs(p.currentTime - this.ref.baseSource) < 0.5;
      if (!applied && Date.now() - this.seekPendingSince < 2000) return this.ref.baseClass;
      if (!applied) record(this.name, 'seek_unconfirmed', { index: this.ref.index, want: this.ref.baseSource, have: Number(p.currentTime.toFixed(3)) });
      else
        record(this.name, 'seek_confirmed', {
          index: this.ref.index,
          ms: Date.now() - this.seekPendingSince,
          classTarget: Number(this.ref.baseClass.toFixed(3)),
          errorMs: Math.round((p.currentTime - this.ref.baseSource) * 1000),
        });
      this.seekPendingSince = null;
    }
    return this.ref.baseClass + (p.currentTime - this.ref.baseSource);
  }

  private startSegment(i: number, classTime: number) {
    const seg = this.placed[i]!;
    const p = this.player(i);
    const into = Math.max(0, classTime - seg.startSeconds);
    // A preloaded player is already parked at its start; seeking again would add latency.
    if (!(this.preloaded.has(i) && into < 0.05)) void p.seekTo(seg.sourceOffsetSeconds + into);
    this.preloaded.delete(i);
    p.volume = seg.crossfadeInSeconds > 0 && into < seg.crossfadeInSeconds ? 0 : seg.gain * this.duck.level;
    p.play();
    this.started.add(i);
    if (!this.ref || i >= this.ref.index) {
      this.ref = { index: i, baseClass: seg.startSeconds + into, baseSource: seg.sourceOffsetSeconds + into };
      this.seekPendingSince = Date.now();
    }
    record(this.name, 'segment_start', { index: i, classTime: Number(classTime.toFixed(3)), expected: seg.startSeconds });
  }

  private tick = () => {
    if (this.state !== 'PLAYING') return;
    const now = this.position();
    // Interruption detection: the reference player stopped although we are PLAYING.
    const refPlayer = this.ref ? this.players.get(this.ref.index) : undefined;
    const refSeg = this.ref ? this.placed[this.ref.index] : undefined;
    if (refPlayer && refSeg && this.seekPendingSince === null) {
      if (refPlayer.playing) this.lastPlayingSeen = Date.now();
      else if (now < refSeg.endSeconds - 0.3 && Date.now() - this.lastPlayingSeen > 750) {
        this.pausedAt = now;
        this.stopLoop();
        for (const i of this.started) this.players.get(i)?.pause();
        record(this.name, 'interruption', { type: 'began', source: 'player_stopped', position: Number(now.toFixed(3)) });
        this.set('INTERRUPTED');
        return;
      }
    }
    // Tracks: preload what is coming up, start any segment whose time has come, stop finished ones.
    this.placed.forEach((seg, i) => {
      if (!this.started.has(i) && !this.preloaded.has(i) && seg.startSeconds > now && seg.startSeconds - now <= PRELOAD_SECONDS) {
        const next = this.player(i);
        next.volume = 0;
        void next.seekTo(seg.sourceOffsetSeconds);
        this.preloaded.add(i);
        record(this.name, 'preload', { index: i, leadSeconds: Number((seg.startSeconds - now).toFixed(3)) });
      }
      if (!this.started.has(i) && now + 1e-3 >= seg.startSeconds && now < seg.endSeconds) this.startSegment(i, now);
      if (this.started.has(i) && now >= seg.endSeconds) {
        // Free finished players: a 45-minute class would otherwise hold one per segment.
        const done = this.players.get(i);
        done?.pause();
        done?.remove();
        this.players.delete(i);
        this.started.delete(i);
        record(this.name, 'track_end', { index: i, lateMs: Math.round((now - seg.endSeconds) * 1000) });
      }
    });
    // Duck automation (JS-driven ramp).
    if (this.duck.ms > 0) {
      const k = Math.min(1, (Date.now() - this.duck.t0) / this.duck.ms);
      this.duck.level = this.duck.from + (this.duck.target - this.duck.from) * k;
      if (k >= 1) this.duck.ms = 0;
    }
    // Per-segment volume: crossfade envelope x duck level.
    for (const i of this.started) {
      const seg = this.placed[i]!;
      let env = 1;
      if (seg.crossfadeInSeconds > 0 && now < seg.startSeconds + seg.crossfadeInSeconds) env = Math.max(0, (now - seg.startSeconds) / seg.crossfadeInSeconds);
      if (seg.crossfadeOutSeconds > 0 && now > seg.endSeconds - seg.crossfadeOutSeconds) env = Math.max(0, (seg.endSeconds - now) / seg.crossfadeOutSeconds);
      const p = this.players.get(i);
      if (p) p.volume = seg.gain * env * this.duck.level;
    }
    // Cues: fire when due, measure lateness against the player clock.
    for (const c of pendingAfterSeek(this.cues, now - 0.5, this.fired)) {
      if (c.timeSeconds > now + (DUCK_ATTACK_MS / 1000)) break;
      if (c.timeSeconds - now <= DUCK_ATTACK_MS / 1000 && this.duck.target === 1) this.rampDuck(c.duckTo, DUCK_ATTACK_MS);
      if (now + 1e-3 >= c.timeSeconds) {
        const cp = this.cuePlayers.get(c.assetId);
        if (cp) {
          void cp.seekTo(0);
          cp.play();
        }
        this.fired.add(c.key);
        record(this.name, 'cue_fired', { key: c.key, expected: c.timeSeconds, actual: Number(now.toFixed(4)), lateMs: Math.round((now - c.timeSeconds) * 1000) });
        setTimeout(() => this.rampDuck(1, DUCK_RELEASE_MS), c.durationSeconds * 1000);
      }
    }
    if (now >= totalDuration(this.placed) && this.placed.length) {
      this.stopLoop();
      this.set('COMPLETED');
    }
  };

  private rampDuck(target: number, ms: number) {
    record(this.name, 'duck', { target, rampMs: ms, from: Number(this.duck.level.toFixed(3)), position: Number(this.position().toFixed(3)) });
    this.duck = { level: this.duck.level, target, t0: Date.now(), from: this.duck.level, ms };
  }

  private startLoop() {
    this.stopLoop();
    this.timer = setInterval(this.tick, TICK_MS);
  }

  private stopLoop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async play(fromSeconds = 0): Promise<void> {
    if (this.state === 'LOADING' || this.state === 'ERROR') return;
    const t0 = Date.now();
    // Start clean: free every player (including preloaded ones a seek skipped past).
    this.players.forEach((p) => {
      p.pause();
      p.remove();
    });
    this.players.clear();
    this.started.clear();
    this.preloaded.clear();
    this.ref = null;
    // Seek policy: cues before the start point are skipped, never played late.
    this.fired = new Set(this.cues.filter((c) => c.timeSeconds < fromSeconds - 1e-3).map((c) => c.key));
    this.duck = { level: 1, target: 1, t0: 0, from: 1, ms: 0 };
    for (const seg of tracksAt(this.placed, fromSeconds)) this.startSegment(seg.index, fromSeconds);
    const first = this.players.get(tracksAt(this.placed, fromSeconds)[0]?.index ?? -1);
    first?.setActiveForLockScreen(true, { title: 'Cadence Audio Lab', artist: 'Cadence' });
    this.lastPlayingSeen = Date.now();
    this.set('PLAYING');
    this.startLoop();
    record(this.name, 'play', { from: fromSeconds, startLatencyMs: Date.now() - t0 });
  }

  async pause(): Promise<void> {
    if (this.state !== 'PLAYING') return;
    this.pausedAt = this.position();
    this.stopLoop();
    for (const i of this.started) this.players.get(i)?.pause();
    this.set('PAUSED');
  }

  async resume(): Promise<void> {
    if (this.state !== 'PAUSED' && this.state !== 'INTERRUPTED') return;
    const at = this.pausedAt;
    await this.play(at);
    // The measured landing point is the following 'seek_confirmed' event (errorMs).
    record(this.name, 'resume', { expected: Number(at.toFixed(3)) });
  }

  async seek(seconds: number): Promise<void> {
    const wasPlaying = this.state === 'PLAYING';
    this.pausedAt = Math.max(0, Math.min(seconds, totalDuration(this.placed)));
    record(this.name, 'seek', { to: this.pausedAt });
    if (wasPlaying) await this.play(this.pausedAt);
    else this.onChange();
  }

  async stop(): Promise<void> {
    this.stopLoop();
    this.players.forEach((p) => p.pause());
    this.started.clear();
    this.fired.clear();
    this.pausedAt = 0;
    this.ref = null;
    this.set('READY');
  }

  snapshot(): EngineSnapshot {
    const pos = this.position();
    const next = pendingAfterSeek(this.cues, pos, this.fired)[0] ?? null;
    return {
      state: this.state,
      positionSeconds: pos,
      currentTrackIds: tracksAt(this.placed, pos).map((t) => t.trackId),
      nextCueKey: next ? `${next.cueId} @ ${next.timeSeconds}s` : null,
      lastError: this.lastError,
      route: null,
    };
  }

  async dispose(): Promise<void> {
    this.stopLoop();
    this.players.forEach((p) => p.remove());
    this.cuePlayers.forEach((p) => p.remove());
    this.players.clear();
    this.cuePlayers.clear();
    this.state = 'IDLE';
  }
}
