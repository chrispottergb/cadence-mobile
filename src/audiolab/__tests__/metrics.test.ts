import { clearLab, exportRun, labEvents, record, setTest, summarizeRun } from '../metrics';

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  clearLab();
});

describe('Audio Lab metrics', () => {
  it('tags every event with the current test and groups the summary by test and engine', () => {
    setTest('T4 Cues');
    record('media-player', 'cue_fired', { key: 'a', lateMs: 12 });
    record('media-player', 'cue_fired', { key: 'b', lateMs: 30 });
    record('audio-graph', 'cue_end', { key: 'a', ctx: 10.005, expectedEnd: 10.0 });
    setTest('T7 30 min');
    record('lab', 'heartbeat', { driftMs: -4, heapBytes: 1000, wallElapsed: 30 });
    record('lab', 'heartbeat', { driftMs: 9, heapBytes: 1500, wallElapsed: 60 });

    expect(labEvents().every((e) => typeof e.data.test === 'string')).toBe(true);
    const s = summarizeRun(labEvents()) as Record<string, { cueLateMs: { n: number; max: number }; cueEndDeliveryMs: { max: number }; driftMs: { final: number; maxAbs: number }; heapBytes: { max: number } }>;
    expect(s['T4 Cues | media-player']!.cueLateMs).toMatchObject({ n: 2, max: 30 });
    expect(s['T4 Cues | audio-graph']!.cueEndDeliveryMs.max).toBe(5);
    expect(s['T7 30 min | lab']!.driftMs).toEqual({ final: 9, maxAbs: 9, samples: 2 });
    expect(s['T7 30 min | lab']!.heapBytes.max).toBe(1500);
  });

  it('exports device info, summary and the raw events together', () => {
    record('lab', 'scenario', { scenario: 'class3' });
    const out = JSON.parse(exportRun({ os: 'ios', model: 'iPhone' }));
    expect(out.device.model).toBe('iPhone');
    expect(out.summary).toBeDefined();
    expect(out.events.length).toBe(out.count);
  });
});
