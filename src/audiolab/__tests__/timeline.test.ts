import { type CueEvent, expandCues, nextCue, pendingAfterSeek, placeTracks, resolveCollisions, totalDuration, tracksAt } from '../timeline';

const ev = (key: string, t: number, dur: number, priority: CueEvent['priority']): CueEvent => ({
  key,
  cueId: key,
  timeSeconds: t,
  assetId: key,
  durationSeconds: dur,
  priority,
  duckTo: 0.3,
});

describe('placeTracks', () => {
  it('uses the ACTUAL rendered duration, not the requested one', () => {
    // Requested 60 s each; the provider returned 54.8 s and 64.76 s.
    const p = placeTracks([
      { trackId: 'A', sourceDurationSeconds: 54.8 },
      { trackId: 'B', sourceDurationSeconds: 64.76 },
    ]);
    expect(p[1]!.startSeconds).toBeCloseTo(54.8);
    expect(totalDuration(p)).toBeCloseTo(119.56);
  });

  it('overlaps a crossfade and never lets it exceed half of either side', () => {
    const p = placeTracks([
      { trackId: 'A', sourceDurationSeconds: 10 },
      { trackId: 'B', sourceDurationSeconds: 10, crossfadeInSeconds: 3 },
      { trackId: 'C', sourceDurationSeconds: 4, crossfadeInSeconds: 30 },
    ]);
    expect(p[1]!.startSeconds).toBe(7);
    expect(p[0]!.crossfadeOutSeconds).toBe(3);
    expect(p[2]!.crossfadeInSeconds).toBe(2); // capped at half of C
    expect(tracksAt(p, 8).map((t) => t.trackId)).toEqual(['A', 'B']);
  });

  it('honours explicit trims and refuses impossible offsets', () => {
    const p = placeTracks([{ trackId: 'A', sourceDurationSeconds: 60, sourceOffsetSeconds: 10, maxDurationSeconds: 20 }]);
    expect(p[0]).toMatchObject({ sourceOffsetSeconds: 10, playSeconds: 20, endSeconds: 20 });
    expect(() => placeTracks([{ trackId: 'X', sourceDurationSeconds: 5, sourceOffsetSeconds: 5 }])).toThrow();
    expect(() => placeTracks([{ trackId: 'Y', sourceDurationSeconds: 0 }])).toThrow();
  });
});

describe('cues', () => {
  it('expands recurring cues within the class and orders by time then priority', () => {
    const e = expandCues(
      [
        { id: 'switch', timeSeconds: 90, repeatEverySeconds: 90, repeatUntilSeconds: 360, assetId: 's', assetDurationSeconds: 1, priority: 'normal' },
        { id: 'bell', timeSeconds: 180, assetId: 'b', assetDurationSeconds: 1.6, priority: 'high' },
      ],
      300,
    );
    expect(e.map((x) => x.key)).toEqual(['switch@90', 'bell@180', 'switch@180', 'switch@270']);
  });

  it('seeking skips cues behind the playhead and never replays fired ones', () => {
    const e = [ev('a', 10, 1, 'normal'), ev('b', 20, 1, 'normal'), ev('c', 30, 1, 'normal')];
    expect(pendingAfterSeek(e, 20, new Set()).map((x) => x.key)).toEqual(['b', 'c']);
    expect(pendingAfterSeek(e, 5, new Set(['a'])).map((x) => x.key)).toEqual(['b', 'c']);
    expect(nextCue(e, 25, new Set())?.key).toBe('c');
    expect(nextCue(e, 31, new Set())).toBeNull();
  });
});

describe('collision policy', () => {
  it('a high cue displaces an overlapping lower cue already scheduled', () => {
    const r = resolveCollisions([ev('motivate', 10, 3, 'low'), ev('bell', 11, 1.6, 'high')]);
    expect(r.play.map((x) => x.key)).toEqual(['bell']);
    expect(r.dropped.map((d) => d.event.key)).toEqual(['motivate']);
  });

  it('a normal cue waits for a high cue when the wait is short, and is dropped when it is long', () => {
    const short = resolveCollisions([ev('bell', 10, 1.6, 'high'), ev('switch', 10.5, 1, 'normal')]);
    expect(short.play.map((x) => [x.key, x.timeSeconds])).toEqual([['bell', 10], ['switch', 11.6]]);
    const long = resolveCollisions([ev('speech', 10, 8, 'high'), ev('switch', 10.5, 1, 'normal')], 3);
    expect(long.play.map((x) => x.key)).toEqual(['speech']);
    expect(long.dropped.map((d) => d.event.key)).toEqual(['switch']);
  });

  it('two overlapping high cues both play, back to back; low cues never overlap anything', () => {
    const r = resolveCollisions([ev('stop', 5, 1, 'high'), ev('round', 5.2, 1.5, 'high'), ev('cheer', 5.4, 1, 'low')]);
    expect(r.play.map((x) => [x.key, Number(x.timeSeconds.toFixed(2))])).toEqual([['stop', 5], ['round', 6]]);
    expect(r.dropped.map((d) => d.event.key)).toEqual(['cheer']);
  });

  it('no two played cues ever overlap', () => {
    const many = Array.from({ length: 40 }, (_, i) => ev(`c${i}`, (i * 7) % 23, 1 + (i % 3), (['high', 'normal', 'low'] as const)[i % 3]!));
    const r = resolveCollisions(many.sort((a, b) => a.timeSeconds - b.timeSeconds));
    for (let i = 1; i < r.play.length; i++) {
      expect(r.play[i]!.timeSeconds + 1e-6).toBeGreaterThanOrEqual(r.play[i - 1]!.timeSeconds + r.play[i - 1]!.durationSeconds);
    }
  });
});
