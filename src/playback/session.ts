import { useSyncExternalStore } from 'react';

import { loadCueAssets, type PlayableTrack, resolveTrack } from '@/audiolab/assets';
import type { PlaybackPlan, SoundtrackSection } from '@/soundtrack/model';

import { createEngine } from './create';
import type { EngineKind, EngineSnapshot, PlaybackEngine } from './engine';

/**
 * App-wide class playback session. Exactly one class soundtrack plays at a
 * time, owned here rather than by any screen, so playback survives leaving
 * the Builder and the mini-player can show and control it from anywhere.
 * Screens call these functions; they never hold an engine themselves.
 */
export interface ClassPlayback {
  soundtrackId: string | null;
  title: string;
  sections: SoundtrackSection[];
  totalSeconds: number;
  engineKind: EngineKind;
  preparing: boolean;
  snapshot: EngineSnapshot | null;
  message: string | null;
}

let engine: PlaybackEngine | null = null;
let run = 0;
let poll: ReturnType<typeof setInterval> | null = null;
let state: ClassPlayback = { soundtrackId: null, title: '', sections: [], totalSeconds: 0, engineKind: 'media-player', preparing: false, snapshot: null, message: null };
const listeners = new Set<() => void>();

function set(patch: Partial<ClassPlayback>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

function startPolling() {
  if (poll) return;
  poll = setInterval(() => {
    if (engine) set({ snapshot: engine.snapshot() });
  }, 250);
}

function stopPolling() {
  if (poll) clearInterval(poll);
  poll = null;
}

export function useClassPlayback(): ClassPlayback {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => state,
  );
}

async function release() {
  const e = engine;
  engine = null;
  stopPolling();
  if (e) {
    await e.stop().catch(() => undefined);
    await e.dispose().catch(() => undefined);
  }
}

export interface StartOptions {
  soundtrackId: string;
  title: string;
  plan: PlaybackPlan;
  sections: SoundtrackSection[];
  musicGain: number;
  library: PlayableTrack[];
  fromSeconds: number;
  engineKind: EngineKind;
}

/** Start (or restart) a class. Any previous class stops first; a newer start cancels an older one still preparing. */
export async function startClass(o: StartOptions): Promise<void> {
  const myRun = ++run;
  await release();
  set({
    soundtrackId: o.soundtrackId,
    title: o.title,
    sections: o.sections,
    totalSeconds: o.plan.totalSeconds,
    engineKind: o.engineKind,
    preparing: true,
    snapshot: null,
    message: 'Preparing...',
  });
  let e: PlaybackEngine | null = null;
  try {
    if (!o.plan.placed.length) throw new Error('Add some music first.');
    const byId = new Map(o.library.map((t) => [t.trackId, t]));
    const loaded = [];
    for (const tid of new Set(o.plan.placed.map((p) => p.trackId))) {
      const t = byId.get(tid);
      if (!t) throw new Error('A track in this soundtrack is no longer available to you.');
      loaded.push(await resolveTrack(t, 'download'));
      if (myRun !== run) return;
    }
    e = createEngine(o.engineKind);
    e.setNowPlaying({ title: o.title, artist: 'Cadence class' });
    await e.load(o.plan.placed, loaded, o.plan.cues, await loadCueAssets());
    if (myRun !== run) {
      await e.dispose();
      return;
    }
    engine = e;
    e.setMusicGain(o.musicGain);
    await e.play(o.fromSeconds);
    startPolling();
    set({ preparing: false, message: null, snapshot: e.snapshot() });
  } catch (err) {
    if (e && engine !== e) await e.dispose().catch(() => undefined);
    if (myRun === run) set({ preparing: false, message: err instanceof Error ? err.message : 'Playback failed.' });
  }
}

export function togglePlay() {
  const e = engine;
  if (!e) return;
  const st = e.snapshot().state;
  if (st === 'PLAYING') void e.pause();
  else if (st === 'PAUSED' || st === 'INTERRUPTED') void e.resume();
  else if (st === 'COMPLETED' || st === 'READY') void e.play(0);
}

export function seekBy(delta: number) {
  const e = engine;
  if (e) void e.seek(Math.max(0, e.snapshot().positionSeconds + delta));
}

export function seekTo(seconds: number) {
  const e = engine;
  if (e) void e.seek(Math.max(0, seconds));
}

/** Stop the class and clear the player. Cancels any start still preparing. */
export async function stopClass(): Promise<number> {
  run += 1;
  const at = engine?.snapshot().positionSeconds ?? 0;
  await release();
  set({ soundtrackId: null, title: '', sections: [], preparing: false, snapshot: null, message: null });
  return at;
}

export const isClassActive = (s: ClassPlayback) => s.preparing || (s.snapshot !== null && s.snapshot.state !== 'IDLE');
