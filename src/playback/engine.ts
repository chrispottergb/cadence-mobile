/**
 * The playback-engine contract (Phase 3 Stage B).
 *
 * Product code (the Class Soundtrack Builder and, later, class playback)
 * talks ONLY to this interface. It never knows whether the implementation is
 * the media-player engine, the audio-graph engine, or a future hybrid; the
 * permanent choice is still open (Stage A evidence continues in parallel).
 *
 * The engine receives a neutral plan (placed tracks + resolved cue events)
 * produced from the ClassSoundtrack timeline, which is the source of truth
 * for class time. Interruptions and audio-route changes are handled INSIDE
 * each engine (the policy is: an interruption pauses and waits for the
 * instructor) and surface through `snapshot().state` / `.route`.
 */
import type { CueEvent, PlacedTrack } from '@/audiolab/timeline';

export type EngineState = 'IDLE' | 'LOADING' | 'READY' | 'PLAYING' | 'PAUSED' | 'INTERRUPTED' | 'COMPLETED' | 'ERROR';

export interface LoadedTrack {
  trackId: string;
  /** Local file path (preferred) or an authorized signed URL. */
  source: string;
  durationSeconds: number;
}

export interface CueAsset {
  assetId: string;
  source: string;
  durationSeconds: number;
}

export interface EngineSnapshot {
  state: EngineState;
  positionSeconds: number;
  currentTrackIds: string[];
  nextCueKey: string | null;
  lastError: string | null;
  route: string | null;
}

export interface PlaybackEngine {
  readonly name: string;
  /** Prepare a plan. Resolves in READY (or ERROR). */
  load(placed: PlacedTrack[], tracks: LoadedTrack[], cues: CueEvent[], assets: CueAsset[]): Promise<void>;
  /** Start (or restart) from a class time. Cues before it are skipped. */
  play(fromSeconds?: number): Promise<void>;
  pause(): Promise<void>;
  /** Continue from the paused/interrupted class time. */
  resume(): Promise<void>;
  /** Jump to a class time; obsolete work from before the jump never becomes audible. */
  seek(seconds: number): Promise<void>;
  stop(): Promise<void>;
  /** Instructor music level for the class (0..1). Never the device's volume. Cue ducking is relative to it. */
  setMusicGain(level: number): void;
  snapshot(): EngineSnapshot;
  /** Investigation only (Stage A/B evidence); product code must not depend on it. */
  diagnostics?(): Record<string, number>;
  /** Release every native resource. Audio stops before anything is released. */
  dispose(): Promise<void>;
}

export type EngineKind = 'media-player' | 'audio-graph';
