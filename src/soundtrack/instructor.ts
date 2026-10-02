import type { PlayableTrack } from '@/audiolab/assets';
import type { Capabilities, GenerateInput } from '@/music/client';
import { type CueRule, type CueWhen, type GuidedPlan, type GuidedSection, newCueRule, newPlan, newSection, roundsSeconds } from './guided';

export const PURPOSES = ['Technique', 'Drilling', 'Sparring', 'Conditioning', 'Mobility', 'Mixed class', 'Custom'] as const;
export const VOCALS = ['Instrumental', 'Sung', 'Rap', 'Chant'] as const;
export interface Instruction {
  id: string;
  text: string;
  sound: 'speech' | 'bell' | 'switch' | 'thirty';
  scope: 'class' | 'main' | 'warmup' | 'cooldown';
  when: CueWhen;
}
export interface InstructorSettings {
  name: string;
  minutes: number;
  purpose: string;
  customPurpose: string;
  warmup: number;
  cooldown: number;
  timed: boolean;
  workSeconds: number;
  restSeconds: number;
  rounds: number;
  cuesEnabled: boolean;
  roundCues: boolean;
  instructions: Instruction[];
  genre: string;
  bpm: string;
  vocals: typeof VOCALS[number];
  lyrics: string;
  source: 'library' | 'generate';
  selectedTracks: string[];
  repeatMusic: boolean;
}
export const defaultInstructorSettings = (): InstructorSettings => ({
  name: '', minutes: 60, purpose: 'Mixed class', customPurpose: '', warmup: 5, cooldown: 5,
  timed: false, workSeconds: 180, restSeconds: 60, rounds: 5, cuesEnabled: true,
  roundCues: true, instructions: [], genre: 'Electronic', bpm: '', vocals: 'Instrumental',
  lyrics: '', source: 'library', selectedTracks: [], repeatMusic: false,
});

export function setupError(s: InstructorSettings): string | null {
  for (let step = 0; step < 4; step++) {
    const error = setupStepError(s, step);
    if (error) return error;
  }
  return null;
}

/** Validate only the visible step so a later setting cannot block navigation to its fix. */
export function setupStepError(s: InstructorSettings, step: number): string | null {
  if (step === 0) {
  if (![s.minutes, s.warmup, s.cooldown].every(Number.isFinite)) return 'Enter valid class durations.';
  if (s.minutes < 5 || s.minutes > 240) return 'Choose a class length from 5 to 240 minutes.';
  if (s.warmup < 0 || s.cooldown < 0 || s.warmup + s.cooldown >= s.minutes) return 'Leave some class time between warm-up and cooldown.';
  if (s.purpose === 'Custom' && !s.customPurpose.trim()) return 'Describe the purpose of your class.';
  if (![s.minutes, s.warmup, s.cooldown].every(Number.isInteger)) return 'Use whole minutes for the class sections.';
  }
  if (step === 1 && s.timed) {
  if (![s.workSeconds, s.restSeconds, s.rounds].every(Number.isFinite)) return 'Enter valid round durations.';
  if (s.timed && (s.workSeconds < 15 || s.restSeconds < 0 || s.rounds < 1 || !Number.isInteger(s.rounds))) return 'Use at least one round, with 15 seconds or more of work.';
  if (s.timed && roundsSeconds({ workSeconds: s.workSeconds, restSeconds: s.restSeconds, count: s.rounds }) > (s.minutes - s.warmup - s.cooldown) * 60) return 'These rounds are longer than the main section. Reduce rounds or adjust the class length.';
  }
  if (step === 3 && s.source === 'generate' && s.bpm && (!/^\d+$/.test(s.bpm) || Number(s.bpm) < 40 || Number(s.bpm) > 240)) return 'Enter a target BPM from 40 to 240, or leave it on Choose for me.';
  if (step === 2 && s.cuesEnabled) for (const i of s.instructions) {
    if (i.sound === 'speech' && (!i.text.trim() || i.text.length > 240)) return 'Enter a spoken instruction of up to 240 characters, or remove the empty cue.';
    if ('seconds' in i.when && (!Number.isFinite(i.when.seconds) || i.when.seconds < (i.when.at === 'once' ? 0 : 5))) return 'Cue intervals must be at least 5 seconds.';
    if (['round_start', 'before_round_end', 'every_round'].includes(i.when.at) && (!s.timed || i.scope !== 'main')) return 'Round cues need timed rounds in the main section. Update or remove those cues.';
    if ((i.scope === 'warmup' && !s.warmup) || (i.scope === 'cooldown' && !s.cooldown)) return 'A cue targets a removed section. Update or remove that cue.';
  }
  return null;
}

function instructionRule(i: Instruction): CueRule {
  return { ...newCueRule('custom', {}), id: i.id, name: i.text.trim() || (i.sound === 'bell' ? 'Bell' : i.sound === 'switch' ? 'Switch' : 'Thirty seconds'),
    sound: i.sound === 'speech' ? 'bell' : i.sound, when: i.when,
    ...(i.sound === 'speech' ? { speechText: i.text.trim() } : {}) };
}

/** Deterministic proposal. Rounds occupy the main section; any remainder is explicit practice time. */
export function proposeClass(s: InstructorSettings): GuidedPlan {
  const error = setupError(s);
  if (error) throw new Error(error);
  const plan = newPlan(s.minutes);
  plan.instructor = s;
  plan.cuesEnabled = s.cuesEnabled;
  const add = (section: GuidedSection, id: string) => { section.id = id; section.cues = []; plan.sections.push(section); return section; };
  if (s.warmup) add(newSection('warmup', s.warmup), 'warmup');
  const mainMinutes = s.minutes - s.warmup - s.cooldown;
  const kind = s.purpose === 'Technique' ? 'technique' : s.purpose === 'Drilling' ? 'drilling' : s.purpose === 'Conditioning' ? 'conditioning' : 'custom';
  const main = add(newSection(kind, mainMinutes), 'main');
  main.label = s.purpose === 'Custom' ? s.customPurpose.trim() : s.purpose;
  if (s.timed) {
    main.rounds = { workSeconds: s.workSeconds, restSeconds: s.restSeconds, count: s.rounds };
    if (s.roundCues) main.cues = [newCueRule('round_start', main), newCueRule('round_end', main)];
  }
  if (s.cooldown) add(newSection('cooldown', s.cooldown), 'cooldown');
  plan.classCues = [];
  for (const i of s.instructions) {
    if (i.sound === 'speech' && !i.text.trim()) continue;
    const rule = instructionRule(i);
    if (i.scope === 'class') plan.classCues.push(rule);
    else plan.sections.find(x => x.id === i.scope)?.cues.push(rule);
  }
  return plan;
}

/** Explicitly selected library tracks, in the instructor's chosen order. No unverified style matching. */
export function fillFromLibrary(plan: GuidedPlan, tracks: PlayableTrack[], repeat: boolean): GuidedPlan {
  const usable = tracks.filter(t => Number.isFinite(t.durationSeconds) && t.durationSeconds > 0 && t.demo === undefined);
  let cursor = 0;
  return { ...plan, sections: plan.sections.map(section => {
    const music: GuidedSection['music'] = [];
    let left = section.minutes * 60;
    while (left > 0 && usable.length && (repeat || cursor < usable.length)) {
      const t = usable[cursor++ % usable.length]!;
      music.push({ assetId: t.trackId, label: t.title, durationSeconds: t.durationSeconds });
      left -= t.durationSeconds;
    }
    return { ...section, music, fill: repeat ? 'repeat' : 'quiet' };
  }) };
}

export function generationInput(s: InstructorSettings, section: GuidedSection, seconds: number, caps: Capabilities, gymId: string): GenerateInput {
  const customLyrics = s.vocals !== 'Instrumental' && !!s.lyrics.trim();
  if (customLyrics && !caps.customLyrics.supported) throw new Error('Custom lyrics are not available from the music service. Clear the lyrics to continue.');
  if (!customLyrics && !caps.descriptionMode.supported) throw new Error('Music descriptions are not available from the music service. Choose library music.');
  if (s.vocals === 'Instrumental' && !caps.instrumental) throw new Error('Instrumental generation is not available. Choose library music.');
  const tags = [s.genre.trim(), s.bpm ? `${s.bpm} BPM` : '', s.vocals === 'Instrumental' ? 'instrumental, no vocals' : `${s.vocals.toLowerCase()} vocals`].filter(Boolean);
  const description = `Music for ${section.label}, part of a ${s.minutes} minute ${s.purpose === 'Custom' ? s.customPurpose : s.purpose} class. ${tags.join(', ')}. Coaching instructions are separate; do not include spoken coaching.`;
  if (customLyrics && caps.customLyrics.maxChars && s.lyrics.length > caps.customLyrics.maxChars) throw new Error(`Keep lyrics within ${caps.customLyrics.maxChars} characters.`);
  if (!customLyrics && caps.descriptionMode.maxChars && description.length > caps.descriptionMode.maxChars) throw new Error('Shorten the class purpose or music style.');
  if (customLyrics && !caps.styleTags.supported) throw new Error('This service cannot combine custom lyrics with the requested style. Use generated lyrics.');
  if (caps.styleTags.supported && caps.styleTags.maxChars && tags.join(', ').length > caps.styleTags.maxChars) throw new Error('Shorten the music style.');
  return { mode: customLyrics ? 'lyrics' : 'description', ...(customLyrics ? { lyrics: s.lyrics } : { description }), title: section.label.slice(0, 40),
    style: { tags: caps.styleTags.supported ? tags : [], exclude: [] }, instrumental: s.vocals === 'Instrumental', subject: { type: 'gym', gymId },
    ...(caps.targetDuration.supported ? { targetDurationSeconds: Math.round(Math.max(caps.targetDuration.minSeconds ?? 1, Math.min(seconds, caps.targetDuration.maxSeconds ?? 120))) } : {}) };
}
