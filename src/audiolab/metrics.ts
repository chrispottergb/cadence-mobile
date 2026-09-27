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
const listeners = new Set<() => void>();

export function record(engine: string, kind: string, data: LabEvent['data'] = {}): void {
  const e: LabEvent = { t: Date.now(), engine, kind, data };
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
  return JSON.stringify({ exportedAt: new Date().toISOString(), device, count: events.length, events });
}
