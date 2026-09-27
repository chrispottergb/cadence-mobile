import type { CueEvent, PlacedTrack } from './timeline';

/**
 * The contract both candidate engines implement in the Audio Lab, so the same
 * tests run against each and the results can be compared directly.
 */
export type EngineState = 'IDLE' | 'LOADING' | 'READY' | 'PLAYING' | 'PAUSED' | 'INTERRUPTED' | 'COMPLETED' | 'ERROR';

export interface LoadedTrack {
  trackId: string;
  /** Local file path (preferred) or an authorized signed URL. */
  source: string;
  durationSeconds: number;
}

export interface CueAsset {
  assetId: string;
  /** Local file path or bundled asset uri. */
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

export interface LabEngine {
  readonly name: string;
  load(placed: PlacedTrack[], tracks: LoadedTrack[], cues: CueEvent[], assets: CueAsset[]): Promise<void>;
  play(fromSeconds?: number): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  seek(seconds: number): Promise<void>;
  stop(): Promise<void>;
  snapshot(): EngineSnapshot;
  dispose(): Promise<void>;
}
