import {
  addCue,
  addSection,
  addTrack,
  addTrackAtFreeSpot,
  appendTrack,
  type ClassSoundtrack,
  issues,
  laneRows,
  newSoundtrack,
  packTracks,
  parseSoundtrack,
  positionAt,
  removeCue,
  reorderTrack,
  sectionAt,
  setDuration,
  sortedTracks,
  toPlan,
  updateCue,
  updateTrack,
} from '../model';

const cueSeconds = () => 1.5;
const A = { assetId: 'gen-a', label: 'A', durationSeconds: 54.8 }; // rendered shorter than the 60 s requested
const B = { assetId: 'gen-b', label: 'B', durationSeconds: 120 };
const C = { assetId: 'gen-c', label: 'C', durationSeconds: 90 };

function three(): ClassSoundtrack {
  let s = newSoundtrack('Kickboxing', 30 * 60);
  s = appendTrack(s, A);
  s = appendTrack(s, B);
  return appendTrack(s, C);
}

describe('tracks', () => {
  it('uses the actual stored duration, never the requested one, and packs back to back', () => {
    const t = sortedTracks(three());
    expect(t.map((x) => [x.label, x.startSeconds, x.durationSeconds])).toEqual([
      ['A', 0, 54.8],
      ['B', 54.8, 120],
      ['C', 174.8, 90],
    ]);
  });

  it('trims never stretch past the asset and offsets stay inside it', () => {
    let s = three();
    const b = sortedTracks(s)[1]!;
    s = updateTrack(s, b.id, { sourceOffsetSeconds: 100, durationSeconds: 60 });
    const nb = s.tracks.find((t) => t.id === b.id)!;
    expect(nb.sourceOffsetSeconds).toBe(100);
    expect(nb.durationSeconds).toBe(20); // only 20 s of the asset remain after the offset
    s = updateTrack(s, b.id, { sourceOffsetSeconds: 500 });
    expect(s.tracks.find((t) => t.id === b.id)!.sourceOffsetSeconds).toBe(119); // clamped inside the asset
  });

  it('reorders two neighbours and repacks them from the earlier start, leaving others alone', () => {
    let s = three();
    const [a, b, c] = sortedTracks(s);
    s = reorderTrack(s, b!.id, -1);
    const t = sortedTracks(s);
    expect(t.map((x) => x.label)).toEqual(['B', 'A', 'C']);
    expect(t[0]!.startSeconds).toBe(0);
    expect(t[1]!.startSeconds).toBe(120);
    expect(t[2]!.startSeconds).toBe(c!.startSeconds);
    expect(a).toBeDefined();
    expect(reorderTrack(s, t[0]!.id, -1)).toBe(s); // first cannot move earlier
  });

  it('packs all tracks from zero and reports overlaps, gaps and tracks past the end', () => {
    let s = newSoundtrack('x', 200);
    s = addTrack(s, A, 0);
    s = addTrack(s, B, 40); // overlaps A by 14.8 s
    s = addTrack(s, C, 180); // gap before, and runs past a 200 s class
    const kinds = issues(s).map((i) => i.kind);
    expect(kinds).toContain('overlap');
    expect(kinds).toContain('gap');
    expect(issues(packTracks(s)).map((i) => i.kind)).not.toContain('overlap');
  });

  it('shortening the class drops or trims what no longer fits', () => {
    let s = three();
    s = addCue(s, 'stop', 1700);
    s = addSection(s, 'Rounds', 100, 1500);
    s = setDuration(s, 150);
    expect(sortedTracks(s).map((t) => t.label)).toEqual(['A', 'B']);
    expect(sortedTracks(s)[1]!.durationSeconds).toBeCloseTo(150 - 54.8, 3);
    expect(s.cues).toHaveLength(0);
    expect(s.sections[0]!.endSeconds).toBe(150);
  });
});

describe('cues and priority', () => {
  it('orders cues by time then priority and resolves collisions deterministically', () => {
    let s = three();
    s = addCue(s, 'motivation', 60); // low
    s = addCue(s, 'round_start', 60); // high, same time
    s = addCue(s, 'switch', 60.5); // normal, overlaps the high cue
    const plan = toPlan(s, cueSeconds);
    const at60 = plan.cues.filter((c) => c.timeSeconds >= 60 && c.timeSeconds < 63);
    expect(at60[0]!.priority).toBe('high');
    expect(at60[0]!.timeSeconds).toBe(60);
    // Low is dropped, normal waits for the high cue to finish: no overlapping speech.
    expect(plan.droppedCueKeys.some((k) => k.startsWith(s.cues[0]!.id))).toBe(true);
    const sw = at60.find((c) => c.priority === 'normal')!;
    expect(sw.timeSeconds).toBeCloseTo(61.5, 3);
    for (let i = 1; i < plan.cues.length; i++) {
      const prev = plan.cues[i - 1]!;
      expect(plan.cues[i]!.timeSeconds).toBeGreaterThanOrEqual(prev.timeSeconds + prev.durationSeconds - 1e-6);
    }
  });

  it('expands repeats inside the class and edits/removes cues by id', () => {
    let s = three();
    s = addCue(s, 'switch', 30, { repeatEverySeconds: 60, repeatUntilSeconds: 200 });
    const id = s.cues[0]!.id;
    expect(toPlan(s, cueSeconds).cues.map((c) => c.timeSeconds)).toEqual([30, 90, 150]);
    s = updateCue(s, id, { timeSeconds: 45 });
    expect(toPlan(s, cueSeconds).cues[0]!.timeSeconds).toBe(45);
    s = removeCue(s, id);
    expect(toPlan(s, cueSeconds).cues).toHaveLength(0);
  });
});

describe('plan and seeking', () => {
  it('maps tracks into the neutral engine plan with offsets, fades and the class gain', () => {
    let s = three();
    const b = sortedTracks(s)[1]!;
    s = updateTrack(s, b.id, { sourceOffsetSeconds: 10, durationSeconds: 60, fadeInSeconds: 2, gain: 0.5 });
    s = { ...s, musicGain: 0.8 };
    const p = toPlan(s, cueSeconds).placed.find((x) => x.trackId === 'gen-b')!;
    expect(p).toMatchObject({ sourceOffsetSeconds: 10, playSeconds: 60, crossfadeInSeconds: 2, startSeconds: 54.8, endSeconds: 114.8 });
    expect(p.gain).toBeCloseTo(0.4, 6);
  });

  it('positionAt gives the active track, its source time, the next cue, and the cues a seek skips', () => {
    let s = three();
    s = addCue(s, 'round_start', 10);
    s = addCue(s, 'stop', 200);
    const plan = toPlan(s, cueSeconds);
    const pos = positionAt(plan, 100);
    expect(pos.active).toEqual([{ trackId: 'gen-b', index: 1, sourceSeconds: 45.2 }]);
    expect(pos.nextCue!.timeSeconds).toBe(200);
    expect(pos.skippedCueKeys).toHaveLength(1);
    expect(positionAt(plan, 200).nextCue!.timeSeconds).toBe(200); // a cue AT the seek point plays
    expect(positionAt(plan, 54.8).active.map((a) => a.trackId)).toEqual(['gen-b']); // boundary belongs to the next track
    expect(positionAt(plan, 5000).active).toEqual([]);
  });
});

describe('sections', () => {
  it('finds the section at a time; boundaries belong to the section that starts there', () => {
    let s = three();
    s = addSection(s, 'Warm-up', 0, 300);
    s = addSection(s, 'Rounds', 300, 1500);
    expect(sectionAt(s, 299.9)!.label).toBe('Warm-up');
    expect(sectionAt(s, 300)!.label).toBe('Rounds');
    expect(sectionAt(s, 1700)).toBeNull();
  });
});

describe('persistence', () => {
  it('round-trips through JSON and rejects unknown or broken documents', () => {
    let s = three();
    s = addCue(s, 'countdown', 1770);
    s = addSection(s, 'Cooldown', 1500, 1800);
    const back = parseSoundtrack(JSON.parse(JSON.stringify(s)));
    expect(back.ok && back.value).toEqual(s);
    expect(parseSoundtrack({ ...s, schemaVersion: 99 }).ok).toBe(false);
    expect(parseSoundtrack({ ...s, cues: [{ id: 'x', type: 'explode', timeSeconds: 1 }] }).ok).toBe(false);
    expect(parseSoundtrack({ ...s, tracks: [{ id: 't', assetId: 'a', assetDurationSeconds: 0 }] }).ok).toBe(false);
    expect(parseSoundtrack(null).ok).toBe(false);
  });
});

describe('adding music at the cursor', () => {
  it('never stacks a new song on music already playing at the cursor', () => {
    let s = newSoundtrack('x', 600);
    s = addTrackAtFreeSpot(s, A, 0);
    s = addTrackAtFreeSpot(s, B, 0); // same cursor: goes after A, not on top of it
    s = addTrackAtFreeSpot(s, C, 10); // inside A: goes after B (A then B cover the spot)
    const t = sortedTracks(s);
    expect(t.map((x) => [x.label, x.startSeconds])).toEqual([
      ['A', 0],
      ['B', 54.8],
      ['C', 174.8],
    ]);
    expect(issues(s).filter((i) => i.kind === 'overlap')).toHaveLength(0);
    expect(addTrackAtFreeSpot(s, A, 400).tracks.at(-1)!.startSeconds).toBe(400); // free spot: exactly at the cursor
  });

  it('puts overlapping tracks on separate display rows', () => {
    let s = newSoundtrack('x', 600);
    s = addTrack(s, A, 0);
    s = addTrack(s, B, 10);
    s = addTrack(s, C, 200);
    const rows = laneRows(s.tracks);
    expect([...rows.values()]).toEqual([0, 1, 0]);
  });
});
