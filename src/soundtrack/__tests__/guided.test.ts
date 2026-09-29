import {
  buildSoundtrack,
  compileCue,
  cueOffsets,
  derivePlan,
  fingerprint,
  guidedState,
  layoutMusic,
  newCueRule,
  newPlan,
  newSection,
  readGuide,
  roundsSeconds,
  roundsThatFit,
  sectionSpans,
  totalMinutes,
} from '../guided';
import { addTrack, newSoundtrack, parseSoundtrack, positionAt, sectionAt, toPlan, updateCue } from '../model';
import { applyTemplate, TEMPLATES } from '../templates';

const base = { name: 'Tuesday BJJ', musicGain: 0.8 };
const song = (id: string, seconds: number) => ({ assetId: id, label: id.toUpperCase(), durationSeconds: seconds });
/** Stored documents come back from jsonb with keys reordered and undefined dropped. */
const roundTrip = <T>(v: T): T => {
  const sortKeys = (x: unknown): unknown =>
    Array.isArray(x) ? x.map(sortKeys) : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => b.localeCompare(a)).map(([k, y]) => [k, sortKeys(y)])) : x;
  return JSON.parse(JSON.stringify(sortKeys(v))) as T;
};

function standard60() {
  const plan = newPlan(60);
  plan.sections = applyTemplate(TEMPLATES[0]!, 60);
  return plan;
}

describe('sections', () => {
  it('builds a 60 minute class from scratch: sections back to back with computed starts and ends', () => {
    const plan = newPlan(60);
    plan.sections = (['warmup', 'technique', 'drilling', 'rounds', 'cooldown'] as const).map((k) => newSection(k));
    expect(totalMinutes(plan)).toBe(60);
    const doc = buildSoundtrack(base, plan);
    expect(doc.durationSeconds).toBe(3600);
    expect(doc.name).toBe('Tuesday BJJ');
    expect(doc.musicGain).toBe(0.8);
    expect(doc.sections.map((s) => [s.label, s.startSeconds, s.endSeconds])).toEqual([
      ['Warm-up', 0, 600],
      ['Technique', 600, 1500],
      ['Drilling', 1500, 2400],
      ['Rounds', 2400, 3300],
      ['Cooldown', 3300, 3600],
    ]);
  });

  it('reorders and resizes by recomputing every start', () => {
    const plan = standard60();
    const [w, t] = plan.sections;
    plan.sections = [t!, w!, ...plan.sections.slice(2)];
    plan.sections[0] = { ...plan.sections[0]!, minutes: 20 };
    const spans = sectionSpans(plan).map((x) => [x.section.kind, x.start, x.end]);
    expect(spans.slice(0, 3)).toEqual([
      ['technique', 0, 1200],
      ['warmup', 1200, 1800],
      ['drilling', 1800, 2700],
    ]);
  });

  it('clips sections that run past the class end', () => {
    const plan = newPlan(30);
    plan.sections = [newSection('warmup', 20), newSection('rounds', 20), newSection('cooldown', 5)];
    const doc = buildSoundtrack(base, plan);
    expect(doc.sections.map((s) => [s.startSeconds, s.endSeconds])).toEqual([
      [0, 1200],
      [1200, 1800],
    ]);
  });

  it('custom sections use their own name', () => {
    const plan = newPlan(30);
    plan.sections = [{ ...newSection('custom', 30), label: 'Games' }];
    expect(buildSoundtrack(base, plan).sections[0]!.label).toBe('Games');
  });
});

describe('templates', () => {
  it('Standard 60 matches the brief exactly', () => {
    expect(applyTemplate(TEMPLATES[0]!, 60).map((s) => [s.kind, s.minutes])).toEqual([
      ['warmup', 10],
      ['technique', 15],
      ['drilling', 15],
      ['rounds', 15],
      ['cooldown', 5],
    ]);
  });

  it.each([30, 45, 60, 75, 90, 37])('every template scales to exactly %i minutes', (m) => {
    for (const t of TEMPLATES) expect(applyTemplate(t, m).reduce((a, s) => a + s.minutes, 0)).toBe(m);
  });

  it('template sections are fresh and editable (new ids each time)', () => {
    const a = applyTemplate(TEMPLATES[0]!, 60);
    const b = applyTemplate(TEMPLATES[0]!, 60);
    expect(a[0]!.id).not.toBe(b[0]!.id);
  });
});

describe('music', () => {
  it('places whole songs back to back and cuts the last one at the section end with a fade', () => {
    const l = layoutMusic({ music: [song('a', 200), song('b', 200), song('c', 300)] }, 600);
    expect(l.pieces.map((p) => [p.music.assetId, p.at, p.seconds, p.cut])).toEqual([
      ['a', 0, 200, false],
      ['b', 200, 200, false],
      ['c', 400, 200, true],
    ]);
    expect(l.cutSeconds).toBe(100);
    expect(l.quietSeconds).toBe(0);
  });

  it('never stretches: a shortfall is reported as quiet time until the instructor decides', () => {
    const l = layoutMusic({ music: [song('a', 150)] }, 600);
    expect(l.filledSeconds).toBe(150);
    expect(l.quietSeconds).toBe(450);
    expect(layoutMusic({ music: [song('a', 150)], fill: 'quiet' }, 600).quietSeconds).toBe(450);
  });

  it('repeat fills the section with the chosen songs in order', () => {
    const l = layoutMusic({ music: [song('a', 150), song('b', 100)], fill: 'repeat' }, 600);
    expect(l.pieces.map((p) => [p.music.assetId, p.seconds, p.repeat])).toEqual([
      ['a', 150, false],
      ['b', 100, false],
      ['a', 150, true],
      ['b', 100, true],
      ['a', 100, true],
    ]);
    expect(l.quietSeconds).toBe(0);
  });

  it('builds tracks inside their section with the stored song length', () => {
    const plan = standard60();
    plan.sections[1] = { ...plan.sections[1]!, music: [song('calm', 500), song('calm2', 500)] };
    const doc = buildSoundtrack(base, plan);
    const t = doc.tracks.map((x) => [x.assetId, x.startSeconds, x.durationSeconds, x.assetDurationSeconds, x.fadeOutSeconds]);
    expect(t).toEqual([
      ['calm', 600, 500, 500, 0],
      ['calm2', 1100, 400, 500, 3],
    ]);
    const plan2 = toPlan(doc, () => 1.5);
    expect(positionAt(plan2, 1200).active).toEqual([{ trackId: 'calm2', index: 1, sourceSeconds: 100 }]);
  });
});

describe('cues', () => {
  const rounds = { workSeconds: 180, restSeconds: 60, count: 5 };
  const sec = { rounds };

  it('round math: 5 x 3 min with 1 min rest takes 19 min; 4 fit in 15', () => {
    expect(roundsSeconds(rounds)).toBe(19 * 60);
    expect(roundsThatFit(rounds, 900)).toBe(4);
  });

  it('computes repeating round events from "every 3 min, rest 1 min, 5 rounds"', () => {
    expect(cueOffsets(newCueRule('round_start', sec), 1200, rounds)).toEqual([0, 240, 480, 720, 960]);
    expect(cueOffsets(newCueRule('round_end', sec), 1200, rounds)).toEqual([180, 420, 660, 900, 1140]);
    expect(cueOffsets(newCueRule('thirty', sec), 1200, rounds)).toEqual([150, 390, 630, 870, 1110]);
    expect(cueOffsets(newCueRule('rest', sec), 1200, rounds)).toEqual([180, 420, 660, 900]);
  });

  it('drops round events that fall outside a section that is too short', () => {
    expect(cueOffsets(newCueRule('round_start', sec), 900, rounds)).toEqual([0, 240, 480, 720]);
  });

  it('non-round timings', () => {
    const r = (when: Parameters<typeof cueOffsets>[0]['when']) => ({ ...newCueRule('custom', {}), when });
    expect(cueOffsets(r({ at: 'every', seconds: 120 }), 600)).toEqual([120, 240, 360, 480]);
    expect(cueOffsets(r({ at: 'once', seconds: 300 }), 600)).toEqual([300]);
    expect(cueOffsets(r({ at: 'once', seconds: 900 }), 600)).toEqual([]);
    expect(cueOffsets(r({ at: 'before_section_end', seconds: 30 }), 600)).toEqual([570]);
    expect(cueOffsets(r({ at: 'section_start' }), 600)).toEqual([0]);
    expect(cueOffsets(newCueRule('thirty', {}), 600)).toEqual([570]);
    expect(cueOffsets(newCueRule('round_start', {}), 600)).toEqual([]); // needs rounds
  });

  it('compiles to one timeline cue with a repeat, a plain-language importance and the cue name', () => {
    const rule = { ...newCueRule('round_start', sec), importance: 'always' as const };
    const c = compileCue(rule, 'sec1', 2400, 1200, rounds)!;
    expect(c).toMatchObject({ id: `sec1~${rule.id}`, timeSeconds: 2400, type: 'round_start', priority: 'high', repeatEverySeconds: 240, repeatUntilSeconds: 3360, label: 'Round start' });
    const custom = compileCue({ ...newCueRule('custom', {}), name: 'Water break', sound: 'stop', importance: 'optional', when: { at: 'once', seconds: 60 } }, 's', 0, 600)!;
    expect(custom).toMatchObject({ type: 'stop', priority: 'low', label: 'Water break', timeSeconds: 60 });
    expect(custom.repeatEverySeconds).toBeUndefined();
  });

  it('rounds sections come with round start/end cues whose events reach the playback plan', () => {
    const plan = standard60();
    const doc = buildSoundtrack(base, plan);
    const events = toPlan(doc, () => 1.5).cues;
    // Rounds section: 15 min at 40:00, default 3 min on / 1 min rest, 4 rounds.
    expect(events.filter((e) => e.assetId === 'round').map((e) => e.timeSeconds)).toEqual([2400, 2640, 2880, 3120]);
    expect(events.filter((e) => e.assetId === 'bell').map((e) => e.timeSeconds)).toEqual([2580, 2820, 3060, 3300]);
  });
});

describe('persistence and Advanced Edit', () => {
  it('the plan survives a save/load round trip and still matches its timeline', () => {
    const plan = standard60();
    plan.sections[0] = { ...plan.sections[0]!, music: [song('a', 200)], fill: 'repeat' };
    const doc = buildSoundtrack(base, plan);
    const parsed = parseSoundtrack(roundTrip(doc));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const st = guidedState(parsed.value);
    expect(st.diverged).toBe(false);
    expect(st.plan.sections.map((s) => s.kind)).toEqual(['warmup', 'technique', 'drilling', 'rounds', 'cooldown']);
    expect(st.plan.sections[0]!.fill).toBe('repeat');
    expect(buildSoundtrack(parsed.value, st.plan).tracks).toEqual(parsed.value.tracks);
  });

  it('an edit made in Advanced Edit is detected, not overwritten silently', () => {
    const doc = buildSoundtrack(base, standard60());
    const cue = doc.cues[0]!;
    const edited = updateCue(doc, cue.id, { timeSeconds: cue.timeSeconds + 5 });
    expect(guidedState(edited).diverged).toBe(true);
    expect(guidedState({ ...doc, name: 'Renamed', musicGain: 0.5 }).diverged).toBe(false);
  });

  it('a class built only on the timeline gets a derived plan and is flagged', () => {
    let s = newSoundtrack('Old', 1800);
    expect(guidedState(s)).toMatchObject({ diverged: false });
    s = { ...s, sections: [{ id: 'x', label: 'Warm', startSeconds: 0, endSeconds: 600 }] };
    s = addTrack(s, { assetId: 'a', label: 'A', durationSeconds: 120 }, 30);
    const st = guidedState(s);
    expect(st.diverged).toBe(true);
    expect(st.plan.minutes).toBe(30);
    expect(st.plan.sections).toHaveLength(1);
    expect(st.plan.sections[0]).toMatchObject({ label: 'Warm', minutes: 10, music: [{ assetId: 'a', durationSeconds: 120 }] });
    expect(derivePlan(newSoundtrack('x', 600)).sections).toEqual([]);
  });

  it('rejects an unreadable plan instead of guessing', () => {
    expect(readGuide({ guide: { version: 1, minutes: 60, sections: [{ id: 'a', kind: 'nope', minutes: 5, music: [], cues: [] }] } })).toBeNull();
    expect(readGuide({ guide: { version: 99, minutes: 60, sections: [] } })).toBeNull();
    expect(readGuide({})).toBeNull();
  });

  it('fingerprint ignores key order', () => {
    const doc = buildSoundtrack(base, standard60());
    expect(fingerprint(roundTrip(doc))).toBe(fingerprint(doc));
  });

  it('section lookups used by the running view work on the compiled timeline', () => {
    const doc = buildSoundtrack(base, standard60());
    expect(sectionAt(doc, 0)?.label).toBe('Warm-up');
    expect(sectionAt(doc, 2500)?.label).toBe('Rounds');
  });
});
