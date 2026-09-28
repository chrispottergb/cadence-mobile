import { GraphEngine } from '@/audiolab/graphEngine';
import { PlayerEngine } from '@/audiolab/playerEngine';

import type { EngineKind, PlaybackEngine } from './engine';

/** The only place that names a concrete engine. The choice is not permanent (Stage A open). */
export function createEngine(kind: EngineKind, onChange: () => void = () => undefined): PlaybackEngine {
  return kind === 'audio-graph' ? new GraphEngine(onChange) : new PlayerEngine(onChange);
}
