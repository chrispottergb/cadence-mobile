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

export class GraphEngine implements LabEngine {
  readonly name = 'audio-graph';
  private ctx: AudioContext | null = null;
  private music: GainNode | null = null;
  private cueBus: GainNode | null = null;
  private buffers = new Map<string, AudioBuffer>();
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
      this.music.connect(this.ctx.destination);
      this.cueBus.connect(this.ctx.destination);
      for (const t of tracks) {
        const d0 = Date.now();
        this.buffers.set(t.trackId, await this.ctx.decodeAudioData(t.source));
        record(this.name, 'decoded', { track: t.trackId, ms: Date.now() - d0, seconds: this.buffers.get(t.trackId)!.duration });
      }
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
    if (this.state === 'PAUSED' || this.state === 'INTERRUPTED' || this.state === 'READY') return this.pausedAt;
    return Math.max(0, this.ctx.currentTime - this.anchor);
  }

  private stopSources() {
    for (const s of this.live) {
      try {
        s.stop();
      } catch {
        /* already ended */
      }
    }
    this.live = [];
    this.music?.gain.cancelScheduledValues(0);
    if (this.music && this.ctx) this.music.gain.setValueAtTime(this.masterLevel, this.ctx.currentTime);
  }

  /** Schedule every track segment and pending cue from class time `from`. */
  private schedule(from: number) {
    const ctx = this.ctx!;
    this.anchor = ctx.currentTime + LEAD - from;
    const scheduleT0 = Date.now();
    for (const p of this.placed) {
      if (p.endSeconds <= from) continue;
      const buf = this.buffers.get(p.trackId);
      if (!buf) continue;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const g = ctx.createGain();
      src.connect(g);
      g.connect(this.music!);
      const into = Math.max(0, from - p.startSeconds);
      const when = this.anchor + p.startSeconds + into;
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
      src.onEnded = () => record(this.name, 'track_end', { track: p.trackId, index: p.index, ctx: Number(ctx.currentTime.toFixed(4)), expected: Number((this.anchor + p.endSeconds).toFixed(4)) });
      this.live.push(src);
    }
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
      src.onEnded = () => {
        this.fired.add(c.key);
        record(this.name, 'cue_end', { key: c.key, ctx: Number(ctx.currentTime.toFixed(4)), expectedEnd: Number((at + buf.duration).toFixed(4)) });
        this.onChange();
      };
      record(this.name, 'cue_scheduled', { key: c.key, classTime: c.timeSeconds, ctxWhen: Number(at.toFixed(4)), priority: c.priority });
      this.live.push(src);
    }
    record(this.name, 'scheduled', { from, sources: this.live.length, jsMs: Date.now() - scheduleT0 });
  }

  async play(fromSeconds = 0): Promise<void> {
    if (!this.ctx || this.state === 'LOADING' || this.state === 'ERROR') return;
    try {
      const t0 = Date.now();
      await this.ctx.resume();
      this.stopSources();
      this.fired = new Set([...this.fired].filter((k) => !pendingAfterSeek(this.cues, fromSeconds, new Set()).some((c) => c.key === k)));
      this.schedule(fromSeconds);
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
    await this.ctx.resume();
    await PlaybackNotificationManager.show({ state: 'playing', elapsedTime: before });
    this.set('PLAYING');
    record(this.name, 'resume', { expected: Number(before.toFixed(3)), actual: Number(this.position().toFixed(3)) });
  }

  async seek(seconds: number): Promise<void> {
    if (!this.ctx) return;
    const wasPlaying = this.state === 'PLAYING';
    this.stopSources();
    this.pausedAt = Math.max(0, Math.min(seconds, totalDuration(this.placed)));
    record(this.name, 'seek', { to: this.pausedAt });
    if (wasPlaying) await this.play(this.pausedAt);
    else this.onChange();
  }

  async stop(): Promise<void> {
    this.stopSources();
    this.fired.clear();
    this.pausedAt = 0;
    if (this.ctx) await this.ctx.suspend();
    await PlaybackNotificationManager.hide().catch(() => undefined);
    this.set('READY');
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
