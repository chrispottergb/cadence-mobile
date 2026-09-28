import { AudioContext, AudioManager, PlaybackNotificationManager, type AudioBuffer, type AudioBufferSourceNode, type GainNode } from 'react-native-audio-api';

import type { CueAsset, EngineSnapshot, EngineState, LabEngine, LoadedTrack } from './engine';
import { record } from './metrics';
import { type CueEvent, pendingAfterSeek, type PlacedTrack, tracksAt, totalDuration } from './timeline';

// NOT public API: interruption and route-change events are only reachable
// through the library's internal emitter. Recorded as a maintenance risk in
// the Stage A report; a library update could break this without a type error.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { AudioEventEmitter } = require('react-native-audio-api/lib/module/events') as {
  AudioEventEmitter: new (native: unknown) => {
    addAudioEventListener(name: 'interruption', cb: (e: { type: 'began' | 'ended'; shouldResume: boolean }) => void): { remove(): void };
    addAudioEventListener(name: 'routeChange', cb: (e: { reason: string }) => void): { remove(): void };
  };
};

/**
 * Candidate 1: an audio graph (react-native-audio-api).
 *
 * Everything is scheduled on ONE clock, the audio context's sample clock:
 * tracks, crossfades, cues and ducking are all `start(when)` and gain
 * automation at context times. Pause suspends the context, so the timeline
 * freezes with it; nothing is re-timed in JavaScript.
 *
 *   track sources -> per-track gain (crossfade) -> music gain (duck) -> out
 *   cue sources   -> cue gain -------------------------------------> out
 */
const LEAD = 0.15; // seconds of scheduling headroom before the first event
const DUCK_ATTACK = 0.25;
const DUCK_RELEASE = 0.6;
/**
 * Rolling window. A class can run 45 minutes over many tracks; decoding every
 * track up front held roughly 570 MB of PCM for the 45-minute test and iOS
 * killed the app on Play (Stage A, build 111). Tracks are now decoded shortly
 * before they are needed, scheduled on the audio clock once inside the
 * window, and their buffers are released after they finish.
 */
const WINDOW_SECONDS = 45;
const PUMP_MS = 1000;
/** Rapid seeks (a finger on +60 s) collapse into one reposition after this much quiet. */
const SEEK_SETTLE_MS = 250;

/** A decode that is no longer needed by the time it would run or finish. */
class StaleDecode extends Error {
  constructor() {
    super('stale decode');
  }
}

export class GraphEngine implements LabEngine {
  readonly name = 'audio-graph';
  private ctx: AudioContext | null = null;
  private music: GainNode | null = null;
  /** Instructor class level, after ducking; ducking ramps on `music` stay relative to it. */
  private level: GainNode | null = null;
  private cueBus: GainNode | null = null;
  private buffers = new Map<string, AudioBuffer>();
  private sources = new Map<string, string>();
  private decoding = new Map<string, Promise<AudioBuffer>>();
  private scheduledSegs = new Map<number, AudioBufferSourceNode>();
  private pumpTimer: ReturnType<typeof setInterval> | null = null;
  private pumping = false;
  /**
   * Playback generation. Every stop, seek or replay starts a new generation;
   * window work started under an older one (for example a decode still in
   * flight when the instructor seeks) must never schedule audio afterwards.
   * Stage A, build 113: without this, each +60 s left an orphaned track
   * playing on top of the new position until the app ran out of memory.
   */
  private gen = 0;
  /**
   * Stage A, build 114: spamming +60 s still crashed. Each tap targeted a
   * different track and started its own ~70 MB decode; ten taps meant ten
   * decodes in flight and ten buffers held. Decodes now run one at a time,
   * are skipped if no longer needed, and are discarded if they finish late.
   */
  private decodeChain: Promise<unknown> = Promise.resolve();
  private seeking = false;
  /** True while play() repositions: the playhead is pausedAt until the new anchor is set. */
  private holding = false;
  /** Class time playback last started from; the playhead never reads earlier during the start-up lead. */
  private playFrom = 0;
  private seekResume = false;
  private seekTimer: ReturnType<typeof setTimeout> | null = null;
  private seekRelease: (() => void) | null = null;
  private seekToken = 0;
  private cueBuffers = new Map<string, AudioBuffer>();
  private placed: PlacedTrack[] = [];
  private cues: CueEvent[] = [];
  private live: AudioBufferSourceNode[] = [];
  private fired = new Set<string>();
  private anchor = 0; // context time at which class time 0 occurs
  private pausedAt = 0;
  private state: EngineState = 'IDLE';
  private lastError: string | null = null;
  private route: string | null = null;
  private subscriptions: { remove(): void }[] = [];
  private masterLevel = 1;

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
      AudioManager.setAudioSessionOptions({ iosCategory: 'playback', iosMode: 'default', iosOptions: [] });
      AudioManager.observeAudioInterruptions(true);
      const emitter = new AudioEventEmitter((globalThis as Record<string, unknown>).AudioEventEmitter);
      this.subscriptions.push(
        emitter.addAudioEventListener('interruption', (e) => {
          record(this.name, 'interruption', { type: e.type, shouldResume: e.shouldResume, position: Number(this.position().toFixed(3)) });
          // Policy: an interruption pauses and WAITS for the instructor. It
          // never auto-resumes into a class the instructor may have stopped.
          if (e.type === 'began' && this.state === 'PLAYING') void this.pause().then(() => this.set('INTERRUPTED'));
        }),
        emitter.addAudioEventListener('routeChange', (e) => {
          this.route = e.reason;
          record(this.name, 'route', { reason: e.reason, state: this.state, position: Number(this.position().toFixed(3)) });
          this.onChange();
        }),
      );
      this.ctx = new AudioContext();
      this.music = this.ctx.createGain();
      this.cueBus = this.ctx.createGain();
      this.level = this.ctx.createGain();
      this.music.connect(this.level);
      this.level.connect(this.ctx.destination);
      this.cueBus.connect(this.ctx.destination);
      for (const t of tracks) this.sources.set(t.trackId, t.source);
      for (const a of assets) this.cueBuffers.set(a.assetId, await this.ctx.decodeAudioData(a.source));
      this.placed = placed;
      this.cues = cues;
      await this.ctx.suspend();
      record(this.name, 'loaded', { ms: Date.now() - t0, tracks: tracks.length, cues: cues.length, sampleRate: this.ctx.sampleRate });
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

  private position(): number {
    if (!this.ctx) return 0;
    if (this.seeking || this.holding) return this.pausedAt;
    if (this.state === 'PAUSED' || this.state === 'INTERRUPTED' || this.state === 'READY') return this.pausedAt;
    return Math.max(this.playFrom, this.ctx.currentTime - this.anchor);
  }

  private stopSources() {
    this.gen += 1;
    this.pumping = false;
    this.stopPump();
    for (const src of [...this.live, ...this.scheduledSegs.values()]) {
      try {
        src.stop();
      } catch {
        /* already ended */
      }
    }
    this.live = [];
    this.scheduledSegs.clear();
    this.music?.gain.cancelScheduledValues(0);
    if (this.music && this.ctx) this.music.gain.setValueAtTime(this.masterLevel, this.ctx.currentTime);
  }

  private pcmBytes(): number {
    let n = 0;
    for (const b of this.buffers.values()) n += b.length * b.numberOfChannels * 4;
    return n;
  }

  /** Is this track needed by any segment near the current (or pending) playhead? */
  private neededSoon(trackId: string): boolean {
    const t = this.position();
    return this.placed.some((p) => p.trackId === trackId && p.endSeconds > t - 1 && p.startSeconds < t + WINDOW_SECONDS);
  }

  private decode(trackId: string): Promise<AudioBuffer> {
    const have = this.buffers.get(trackId);
    if (have) return Promise.resolve(have);
    const pending = this.decoding.get(trackId);
    if (pending) return pending;
    // One decode at a time; each checks it is still wanted before and after.
    const job = this.decodeChain.then(async () => {
      if (!this.ctx || !this.neededSoon(trackId)) {
        record(this.name, 'decode_skipped', { track: trackId });
        throw new StaleDecode();
      }
      const d0 = Date.now();
      const buf = await this.ctx.decodeAudioData(this.sources.get(trackId)!);
      if (!this.ctx || !this.neededSoon(trackId)) {
        record(this.name, 'decode_discarded', { track: trackId, ms: Date.now() - d0 });
        throw new StaleDecode();
      }
      this.buffers.set(trackId, buf);
      record(this.name, 'decoded', {
        track: trackId,
        ms: Date.now() - d0,
        seconds: buf.duration,
        pcmBytes: buf.length * buf.numberOfChannels * 4,
        heldBytes: this.pcmBytes(),
        held: this.buffers.size,
      });
      return buf;
    });
    const tracked = job.finally(() => this.decoding.delete(trackId));
    this.decoding.set(trackId, tracked);
    this.decodeChain = tracked.catch(() => undefined);
    return tracked;
  }

  /** Decode and schedule every segment entering the window; release buffers no longer needed. */
  private async pump(): Promise<void> {
    if (this.pumping || !this.ctx) return;
    this.pumping = true;
    const gen = this.gen;
    const stale = () => gen !== this.gen || this.ctx === null;
    try {
      const ctx = this.ctx;
      for (const p of this.placed) {
        const now = this.position();
        if (this.scheduledSegs.has(p.index) || p.endSeconds <= now || p.startSeconds > now + WINDOW_SECONDS) continue;
        const buf = await this.decode(p.trackId);
        if (stale()) {
          record(this.name, 'stale_window_dropped', { index: p.index });
          return;
        }
        if (this.ctx !== ctx || this.scheduledSegs.has(p.index)) continue;
        const nowAfter = this.position();
        if (p.endSeconds <= nowAfter) continue;
        // A segment that should already be sounding joins at the current position.
        const into = Math.max(0, nowAfter + (this.state === 'PLAYING' ? 0.05 : 0) - p.startSeconds);
        const when = this.anchor + p.startSeconds + into;
        if (into > 0.05) record(this.name, 'segment_late', { index: p.index, lateMs: Math.round(into * 1000) });
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const g = ctx.createGain();
        src.connect(g);
        g.connect(this.music!);
        const vol = p.gain;
        // Crossfade in/out as real overlapping sources with gain ramps.
        if (p.crossfadeInSeconds > 0 && into < p.crossfadeInSeconds) {
          g.gain.setValueAtTime(vol * (into / p.crossfadeInSeconds), when);
          g.gain.linearRampToValueAtTime(vol, this.anchor + p.startSeconds + p.crossfadeInSeconds);
        } else g.gain.setValueAtTime(vol, when);
        if (p.crossfadeOutSeconds > 0) {
          const fadeStart = this.anchor + p.endSeconds - p.crossfadeOutSeconds;
          g.gain.setValueAtTime(vol, Math.max(when, fadeStart));
          g.gain.linearRampToValueAtTime(0, this.anchor + p.endSeconds);
        }
        src.start(when, p.sourceOffsetSeconds + into, p.playSeconds - into);
        src.onEnded = () => {
          if (gen !== this.gen) return; // stopped by a seek/stop: not a natural track end
          record(this.name, 'track_end', { track: p.trackId, index: p.index, ctx: Number(ctx.currentTime.toFixed(4)), expected: Number((this.anchor + p.endSeconds).toFixed(4)) });
          this.scheduledSegs.delete(p.index);
        };
        this.scheduledSegs.set(p.index, src);
        record(this.name, 'segment_scheduled', { index: p.index, ctxWhen: Number(when.toFixed(4)), into: Number(into.toFixed(3)) });
      }
      if (stale()) return;
      // Release buffers that no segment in the window still needs.
      const t = this.position();
      const needed = new Set(this.placed.filter((p) => p.endSeconds > t - 1 && p.startSeconds < t + WINDOW_SECONDS).map((p) => p.trackId));
      for (const id of [...this.buffers.keys()]) {
        if (!needed.has(id)) {
          this.buffers.delete(id);
          record(this.name, 'released', { track: id, heldBytes: this.pcmBytes(), held: this.buffers.size });
        }
      }
    } catch (e) {
      if (!(e instanceof StaleDecode)) this.fail(e);
    } finally {
      // Only the current generation owns the flag; a stale pump must not clear a newer one's.
      if (gen === this.gen) this.pumping = false;
    }
  }

  private startPump() {
    this.stopPump();
    this.pumpTimer = setInterval(() => void this.pump(), PUMP_MS);
  }

  private stopPump() {
    if (this.pumpTimer) clearInterval(this.pumpTimer);
    this.pumpTimer = null;
  }

  /** Anchor class time `from` to the audio clock, schedule pending cues, and fill the track window. */
  private async schedule(from: number) {
    const ctx = this.ctx!;
    const scheduleT0 = Date.now();
    this.anchor = ctx.currentTime + LEAD - from;
    this.playFrom = from;
    this.holding = false;
    for (const c of pendingAfterSeek(this.cues, from, this.fired)) {
      const buf = this.cueBuffers.get(c.assetId);
      if (!buf) continue;
      const at = this.anchor + c.timeSeconds;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(this.cueBus!);
      src.start(at);
      // Duck: ramp down just before the cue, hold, ramp back after it.
      const mg = this.music!.gain;
      mg.setValueAtTime(this.masterLevel, Math.max(ctx.currentTime, at - DUCK_ATTACK));
      mg.linearRampToValueAtTime(this.masterLevel * c.duckTo, at);
      mg.setValueAtTime(this.masterLevel * c.duckTo, at + c.durationSeconds);
      mg.linearRampToValueAtTime(this.masterLevel, at + c.durationSeconds + DUCK_RELEASE);
      record(this.name, 'duck_scheduled', {
        key: c.key,
        attackStart: Number(Math.max(ctx.currentTime, at - DUCK_ATTACK).toFixed(4)),
        cueStart: Number(at.toFixed(4)),
        cueEnd: Number((at + c.durationSeconds).toFixed(4)),
        restored: Number((at + c.durationSeconds + DUCK_RELEASE).toFixed(4)),
        duckTo: c.duckTo,
        master: this.masterLevel,
      });
      const cueGen = this.gen;
      src.onEnded = () => {
        if (cueGen !== this.gen) return; // cancelled by seek/stop, not played out
        this.fired.add(c.key);
        record(this.name, 'cue_end', { key: c.key, ctx: Number(ctx.currentTime.toFixed(4)), expectedEnd: Number((at + buf.duration).toFixed(4)) });
        this.onChange();
      };
      record(this.name, 'cue_scheduled', { key: c.key, classTime: c.timeSeconds, ctxWhen: Number(at.toFixed(4)), priority: c.priority });
      this.live.push(src);
    }
    await this.pump();
    this.startPump();
    record(this.name, 'scheduled', { from, cueSources: this.live.length, trackSources: this.scheduledSegs.size, jsMs: Date.now() - scheduleT0, heldBytes: this.pcmBytes() });
  }

  async play(fromSeconds = 0): Promise<void> {
    if (!this.ctx || this.state === 'LOADING' || this.state === 'ERROR') return;
    try {
      const t0 = Date.now();
      this.stopSources();
      const gen = this.gen;
      this.pausedAt = fromSeconds;
      this.holding = true;
      // Decode what is needed first while the clock is still stopped, so the
      // opening track starts on time instead of joining late.
      const first = this.placed.filter((p) => p.endSeconds > fromSeconds && p.startSeconds < fromSeconds + 1);
      try {
        await Promise.all(first.map((p) => this.decode(p.trackId)));
      } catch (e) {
        if (e instanceof StaleDecode) return; // a newer seek/stop took over
        throw e;
      }
      if (gen !== this.gen || !this.ctx) return; // superseded by a newer seek/stop while decoding
      await this.ctx.resume();
      if (gen !== this.gen) return;
      this.fired = new Set([...this.fired].filter((k) => !pendingAfterSeek(this.cues, fromSeconds, new Set()).some((c) => c.key === k)));
      await this.schedule(fromSeconds);
      await PlaybackNotificationManager.show({ title: 'Cadence Audio Lab', state: 'playing', duration: totalDuration(this.placed), elapsedTime: fromSeconds });
      record(this.name, 'play', { from: fromSeconds, startLatencyMs: Date.now() - t0 + LEAD * 1000 });
      this.set('PLAYING');
    } catch (e) {
      this.fail(e);
    }
  }

  async pause(): Promise<void> {
    if (!this.ctx || this.state !== 'PLAYING') return;
    this.pausedAt = this.position();
    await this.ctx.suspend(); // freezes the clock: sources, ramps and cues all hold
    await PlaybackNotificationManager.show({ state: 'paused', elapsedTime: this.pausedAt });
    this.set('PAUSED');
  }

  async resume(): Promise<void> {
    if (!this.ctx || (this.state !== 'PAUSED' && this.state !== 'INTERRUPTED')) return;
    const before = this.pausedAt;
    // A seek while paused cleared the scheduled sources: rebuild from the playhead.
    if (this.scheduledSegs.size === 0 && this.live.length === 0) {
      await this.play(before);
      record(this.name, 'resume', { expected: Number(before.toFixed(3)), actual: Number(this.position().toFixed(3)), rescheduled: true });
      return;
    }
    await this.ctx.resume();
    await PlaybackNotificationManager.show({ state: 'playing', elapsedTime: before });
    this.set('PLAYING');
    record(this.name, 'resume', { expected: Number(before.toFixed(3)), actual: Number(this.position().toFixed(3)) });
  }

  async seek(seconds: number): Promise<void> {
    if (!this.ctx) return;
    // A seek during a settling seek keeps the original intent to keep playing.
    const wasPlaying = this.state === 'PLAYING' || (this.seeking && this.seekResume);
    this.stopSources();
    this.pausedAt = Math.max(0, Math.min(seconds, totalDuration(this.placed)));
    this.seeking = true;
    this.seekResume = wasPlaying;
    record(this.name, 'seek', { to: this.pausedAt });
    this.onChange();
    // Supersede any settling seek: its promise resolves and it does nothing more.
    if (this.seekTimer) clearTimeout(this.seekTimer);
    this.seekRelease?.();
    const token = ++this.seekToken;
    await new Promise<void>((resolve) => {
      this.seekRelease = resolve;
      this.seekTimer = setTimeout(() => {
        this.seekTimer = null;
        this.seekRelease = null;
        resolve();
      }, SEEK_SETTLE_MS);
    });
    if (token !== this.seekToken || !this.seeking) return; // a later seek (or stop) owns the reposition
    this.seeking = false;
    record(this.name, 'seek_settled', { to: this.pausedAt, resume: this.seekResume });
    if (this.seekResume) await this.play(this.pausedAt);
    else this.onChange();
  }

  private cancelSeek() {
    if (this.seekTimer) clearTimeout(this.seekTimer);
    this.seekTimer = null;
    this.seekToken += 1;
    this.seekRelease?.();
    this.seekRelease = null;
    this.seeking = false;
    this.holding = false;
    this.seekResume = false;
  }

  async stop(): Promise<void> {
    this.cancelSeek();
    this.stopSources();
    this.fired.clear();
    this.pausedAt = 0;
    if (this.ctx) await this.ctx.suspend();
    await PlaybackNotificationManager.hide().catch(() => undefined);
    this.set('READY');
  }

  /** Live native-resource counts for the memory investigation. */
  diagnostics(): Record<string, number> {
    return {
      cueSourcesLive: this.live.length,
      trackSourcesLive: this.scheduledSegs.size,
      buffersHeld: this.buffers.size,
      buffersHeldBytes: this.pcmBytes(),
      cueBuffers: this.cueBuffers.size,
      decodesInFlight: this.decoding.size,
      firedCueKeys: this.fired.size,
      subscriptions: this.subscriptions.length,
    };
  }

  setMusicGain(level: number): void {
    const v = Math.min(1, Math.max(0, level));
    if (this.level && this.ctx) {
      this.level.gain.cancelScheduledValues(0);
      this.level.gain.setValueAtTime(v, this.ctx.currentTime);
    }
    record(this.name, 'music_gain', { level: v });
  }

  snapshot(): EngineSnapshot {
    const pos = this.position();
    if (this.state === 'PLAYING' && pos >= totalDuration(this.placed) && this.placed.length) {
      this.state = 'COMPLETED';
      record(this.name, 'state', { state: 'COMPLETED', position: pos });
    }
    const next = pendingAfterSeek(this.cues, pos, this.fired)[0] ?? null;
    return {
      state: this.state,
      positionSeconds: pos,
      currentTrackIds: tracksAt(this.placed, pos).map((t) => t.trackId),
      nextCueKey: next ? `${next.cueId} @ ${next.timeSeconds}s` : null,
      lastError: this.lastError,
      route: this.route,
    };
  }

  async dispose(): Promise<void> {
    this.cancelSeek();
    this.stopSources();
    for (const sub of this.subscriptions) {
      try {
        sub.remove();
      } catch {
        /* ignore */
      }
    }
    this.subscriptions = [];
    await PlaybackNotificationManager.hide().catch(() => undefined);
    await this.ctx?.close();
    this.ctx = null;
    this.buffers.clear();
    this.cueBuffers.clear();
    this.state = 'IDLE';
  }
}
