/**
 * Audio Lab measurement log. Every entry is printed with a fixed tag so a
 * device run can be collected with `adb logcat -s ReactNativeJS | grep CADENCE_LAB`
 * and kept in memory for the on-screen panel. Numbers only; no user data.
 */
export interface LabEvent {
  t: number; // Date.now()
  engine: string;
  kind: string;
  data: Record<string, number | string | boolean | null>;
}

const events: LabEvent[] = [];
let currentTest = 'untagged';

/** Tag every following event with the Stage A test being run. */
export function setTest(label: string): void {
  currentTest = label;
  record('tester', 'test_start', { label });
}
export const getTest = () => currentTest;
const listeners = new Set<() => void>();

export function record(engine: string, kind: string, data: LabEvent['data'] = {}): void {
  const e: LabEvent = { t: Date.now(), engine, kind, data: { ...data, test: currentTest } };
  events.push(e);
  if (events.length > 2000) events.splice(0, events.length - 2000);
  console.log(`CADENCE_LAB ${JSON.stringify(e)}`);
  listeners.forEach((l) => l());
}

export const labEvents = () => events;
export const subscribeLab = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

/** Summary statistics for a list of millisecond errors. */
export function summarize(values: number[]) {
  if (!values.length) return { n: 0, mean: 0, p50: 0, p95: 0, max: 0 };
  const s = [...values].sort((a, b) => a - b);
  const at = (q: number) => s[Math.min(s.length - 1, Math.floor(q * s.length))]!;
  return {
    n: s.length,
    mean: Math.round((s.reduce((a, b) => a + b, 0) / s.length) * 10) / 10,
    p50: Math.round(at(0.5) * 10) / 10,
    p95: Math.round(at(0.95) * 10) / 10,
    max: Math.round(Math.max(...s.map(Math.abs)) * 10) / 10,
  };
}

export function clearLab(): void {
  events.splice(0, events.length);
  listeners.forEach((l) => l());
}

/** JavaScript heap size in bytes when the Hermes runtime exposes it (null otherwise). */
export function jsHeapBytes(): number | null {
  const h = (globalThis as { HermesInternal?: { getInstrumentedStats?: () => Record<string, number> } }).HermesInternal;
  const s = h?.getInstrumentedStats?.();
  return s && typeof s.js_heapSize === 'number' ? s.js_heapSize : null;
}

/** The full run as JSON for the Stage A report: device, build, events. No user data. */
export function exportRun(device: Record<string, string | number | null>): string {
  return JSON.stringify({ exportedAt: new Date().toISOString(), device, summary: summarizeRun(events), count: events.length, events });
}

/**
 * Per test and engine: the numbers the Stage A report needs, computed from
 * raw events (which are exported alongside, unmodified).
 */
export function summarizeRun(list: LabEvent[]) {
  const groups = new Map<string, LabEvent[]>();
  for (const e of list) {
    const k = `${e.data.test ?? 'untagged'} | ${e.engine}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(e);
  }
  const out: Record<string, unknown> = {};
  for (const [k, es] of groups) {
    const of = (kind: string) => es.filter((e) => e.kind === kind);
    const num = (e: LabEvent, f: string) => Number(e.data[f]);
    // Media-player engine: JS-fired cue lateness against the player clock.
    const late = of('cue_fired').map((e) => num(e, 'lateMs'));
    // Audio-graph engine: cue end callback time vs the scheduled end on the audio clock (upper bound on delivery lag).
    const graphEnd = of('cue_end').map((e) => Math.round((num(e, 'ctx') - num(e, 'expectedEnd')) * 1000));
    const trackEnd = of('track_end').map((e) => (e.data.lateMs !== undefined ? num(e, 'lateMs') : Math.round((num(e, 'ctx') - num(e, 'expected')) * 1000)));
    const hb = of('heartbeat');
    const drift = hb.map((e) => num(e, 'driftMs'));
    const heap = hb.map((e) => num(e, 'heapBytes')).filter((n) => Number.isFinite(n) && n > 0);
    out[k] = {
      events: es.length,
      states: of('state').map((e) => e.data.state),
      cueLateMs: summarize(late),
      cueEndDeliveryMs: summarize(graphEnd),
      trackEndMs: summarize(trackEnd),
      driftMs: { final: drift.at(-1) ?? null, maxAbs: drift.length ? Math.max(...drift.map(Math.abs)) : null, samples: drift.length },
      heapBytes: heap.length ? { first: heap[0], last: heap.at(-1), max: Math.max(...heap) } : null,
      playedSeconds: hb.length ? num(hb.at(-1)!, 'wallElapsed') : null,
      interruptions: of('interruption').map((e) => e.data),
      routes: of('route').map((e) => e.data),
      marks: of('mark').map((e) => ({ note: e.data.note, position: e.data.position, t: e.t })),
      ducks: of('duck').length + of('duck_scheduled').length,
      errors: of('error').map((e) => e.data.message),
      resumes: of('resume').map((e) => e.data),
    };
  }
  return out;
}
