import { buildSoundtrack, cueOffsets, guidedState, layoutMusic } from '../guided';
import { defaultInstructorSettings, fillFromLibrary, generationInput, proposeClass, setupError, setupStepError } from '../instructor';
import { parseSoundtrack, toPlan } from '../model';
import { speechText } from '../speech';
import type { Capabilities } from '@/music/client';

const caps: Capabilities = { customLyrics: { supported: true, maxChars: 1000 }, descriptionMode: { supported: true }, instrumental: true, styleTags: { supported: true }, negativeTags: { supported: false }, models: [], defaultModel: 'default', targetDuration: { supported: true, minSeconds: 30, maxSeconds: 180 }, candidatesPerJob: 2 };
const track = (id: string, durationSeconds: number) => ({ trackId: id, title: id, durationSeconds, jobId: 'j', label: 'A' });

it('proposes exactly 60 minutes and keeps rounds within the main section', () => {
  const s = { ...defaultInstructorSettings(), timed: true, rounds: 8, workSeconds: 300, restSeconds: 60 };
  const plan = proposeClass(s);
  const doc = buildSoundtrack({ name: 'Drills', musicGain: 1 }, plan);
  expect(doc.sections.map(x => [x.startSeconds, x.endSeconds])).toEqual([[0, 300], [300, 3300], [3300, 3600]]);
  expect(plan.sections[1]!.rounds?.count).toBe(8);
  expect(setupError({ ...s, rounds: 9 })).toMatch(/longer/);
});

it('places repeating spoken instructions inside work rounds, never in rests', () => {
  const s = defaultInstructorSettings();
  s.timed = true; s.workSeconds = 90; s.restSeconds = 45; s.rounds = 2;
  s.instructions = [{ id: 'speak', text: 'Switch partners', sound: 'speech', scope: 'main', when: { at: 'every_round', seconds: 30 } }];
  const plan = proposeClass(s);
  const main = plan.sections[1]!;
  expect(cueOffsets(main.cues[2]!, main.minutes * 60, main.rounds)).toEqual([30, 60, 165, 195]);
  const doc = buildSoundtrack({ name: 'Rounds', musicGain: 1 }, plan);
  const speech = toPlan(doc, () => 1).cues.filter(c => speechText(c.assetId) !== null);
  expect(speech.map(c => c.timeSeconds)).toEqual([330, 360, 465, 495]);
  expect(speech.map(c => speechText(c.assetId))).toEqual(Array(4).fill('Switch partners'));
});

it('preserves instructions across save/reload and music-only mode', () => {
  const s = defaultInstructorSettings();
  s.instructions = [{ id: 's', text: 'Breathe deeply', sound: 'speech', scope: 'class', when: { at: 'every', seconds: 120 } }];
  s.cuesEnabled = false;
  const doc = buildSoundtrack({ name: 'Mobility', musicGain: 1 }, proposeClass(s));
  const parsed = parseSoundtrack(JSON.parse(JSON.stringify(doc)));
  if (!parsed.ok) throw new Error(parsed.error);
  expect(toPlan(parsed.value, () => 1).cues).toEqual([]);
  const g = guidedState(parsed.value);
  expect(g.diverged).toBe(false);
  expect(g.plan.classCues![0]!.speechText).toBe('Breathe deeply');
  expect(toPlan({ ...parsed.value, cuesEnabled: true }, () => 1).cues).toHaveLength(29);
});

it('uses chosen tracks without stretching and repeats only when requested', () => {
  const p = proposeClass(defaultInstructorSettings());
  const once = fillFromLibrary(p, [track('one', 200)], false);
  expect(layoutMusic(once.sections[0]!, 300).quietSeconds).toBe(100);
  expect(once.sections[1]!.music).toHaveLength(0);
  const repeated = fillFromLibrary(p, [track('one', 200)], true);
  const doc = buildSoundtrack({ name: 'Repeat', musicGain: 1 }, repeated);
  expect(doc.tracks.at(-1)!.startSeconds + doc.tracks.at(-1)!.durationSeconds).toBe(3600);
  expect(doc.tracks.every(t => t.durationSeconds <= 200)).toBe(true);
});

it('keeps coaching text out of generated lyrics and respects provider capabilities', () => {
  const s = { ...defaultInstructorSettings(), vocals: 'Rap' as const, bpm: '120', lyrics: 'Move to the beat' };
  s.instructions = [{ id: 's', text: 'Switch partners', sound: 'speech', scope: 'main', when: { at: 'every', seconds: 120 } }];
  const section = proposeClass(s).sections[1]!;
  const request = generationInput(s, section, 3000, caps, 'gym');
  expect(request.lyrics).toBe('Move to the beat');
  expect(request.style.tags).toContain('rap vocals');
  expect(request.targetDurationSeconds).toBe(180);
  expect(JSON.stringify(request)).not.toContain('Switch partners');
  expect(() => generationInput(s, section, 300, { ...caps, customLyrics: { supported: false } }, 'gym')).toThrow(/lyrics/);
});

it('rejects invalid timings and empty spoken instructions', () => {
  const s = defaultInstructorSettings();
  expect(setupError({ ...s, minutes: NaN })).toMatch(/valid/);
  expect(setupError({ ...s, source: 'generate', bpm: '999' })).toMatch(/BPM/);
  s.instructions = [{ id: 's', text: '', sound: 'speech', scope: 'main', when: { at: 'every', seconds: 0 } }];
  expect(setupError(s)).toMatch(/spoken/);
  s.instructions[0]!.text = 'Switch';
  expect(setupError(s)).toMatch(/intervals/);
});

it('lets instructors reach the step that repairs dependent settings', () => {
  const s = { ...defaultInstructorSettings(), minutes: 15, timed: true, rounds: 8 };
  expect(setupStepError(s, 0)).toBeNull();
  expect(setupStepError(s, 1)).toMatch(/longer/);
  s.minutes = 60;
  s.instructions = [{ id: 'cue', text: '', sound: 'speech', scope: 'main', when: { at: 'every', seconds: 120 } }];
  expect(setupStepError(s, 1)).toBeNull();
  expect(setupStepError(s, 2)).toMatch(/spoken/);
  expect(setupError(s)).toMatch(/spoken/);
});
