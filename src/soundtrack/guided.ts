/**
 * Guided Class Builder: the instructor describes the CLASS, Cadence builds
 * the AUDIO TIMELINE.
 *
 * A GuidedPlan is a plain description of a class: its length, its sections
 * in order (each with minutes, intensity, chosen music and cue rules such as
 * "round start, every 3 min, 5 rounds"). `buildSoundtrack` compiles it into
 * an ordinary ClassSoundtrack (tracks at explicit times, cues with priority,
 * duck level and repeats, sections), so everything downstream - toPlan, the
 * engines, the global player, persistence - is unchanged.
 *
 * Section kinds are organisational labels with friendly defaults, not a
 * methodology: every value is editable and the timeline model knows nothing
 * about them. Music is never stretched: a section is filled by placing whole
 * songs back to back, the last one cut (with a short fade) at the section's
 * end, and any shortfall is surfaced to the instructor to resolve.
 *
 * The plan is stored on the document (`guide`) with a fingerprint of the
 * timeline it produced. If the timeline is later changed in Advanced Edit,
 * the fingerprint no longer matches and the Guided Builder says so instead
 * of silently overwriting those edits.
 */
import {
  type ClassSoundtrack,
  CUE_TYPES,
  type CueType,
  MAX_CLASS_SECONDS,
  newId,
  newSoundtrack,
  normalizeTrack,
  type SoundtrackCue,
  type SoundtrackSection,
  type SoundtrackTrack,
} from './model';
import type { CuePriority } from '@/audiolab/timeline';

export const GUIDE_VERSION = 1;
export const CLASS_LENGTHS = [30, 45, 60, 75, 90] as const;
export const MAX_CLASS_MINUTES = MAX_CLASS_SECONDS / 60;
/** Don't place a sliver of a song shorter than this at a section's end. */
const MIN_PIECE_SECONDS = 3;
/** Fade applied to a song that is cut at its section's end. */
const CUT_FADE_SECONDS = 3;

export type SectionKind = 'warmup' | 'technique' | 'drilling' | 'rounds' | 'conditioning' | 'cooldown' | 'custom';

export const SECTION_KINDS: Record<SectionKind, { label: string; minutes: number; intensity: number; style: string; blurb: string }> = {
  warmup: { label: 'Warm-up', minutes: 10, intensity: 2, style: 'upbeat, steady groove', blurb: 'Get moving, raise the heart rate' },
  technique: { label: 'Technique', minutes: 15, intensity: 1, style: 'calm, low-key instrumental', blurb: 'Teaching and demonstration' },
  drilling: { label: 'Drilling', minutes: 15, intensity: 3, style: 'driving, focused', blurb: 'Partner reps' },
  rounds: { label: 'Rounds', minutes: 15, intensity: 5, style: 'intense, high energy', blurb: 'Sparring or timed rounds' },
  conditioning: { label: 'Conditioning', minutes: 10, intensity: 4, style: 'hard-hitting, fast', blurb: 'Fitness work' },
  cooldown: { label: 'Cooldown', minutes: 5, intensity: 1, style: 'relaxed, ambient', blurb: 'Stretch and recover' },
  custom: { label: 'Custom', minutes: 5, intensity: 3, style: 'steady', blurb: 'Name it yourself' },
};
export const SECTION_ORDER: SectionKind[] = ['warmup', 'technique', 'drilling', 'rounds', 'conditioning', 'cooldown', 'custom'];

/** 1 (low) .. 5 (high). */
export const INTENSITY_LEVELS = [1, 2, 3, 4, 5] as const;
export const INTENSITY_WORDS = ['', 'Low', 'Easy', 'Medium', 'Hard', 'High'] as const;

export interface GuidedMusic {
  assetId: string;
  label: string;
  /** Actual stored length of the song, seconds. */
  durationSeconds: number;
}

/** What to do when the chosen music is shorter than the section. Unset = not decided yet (quiet until then). */
export type FillChoice = 'repeat' | 'quiet';

export interface Rounds {
  workSeconds: number;
  restSeconds: number;
  count: number;
}

export type CueKind = 'round_start' | 'round_end' | 'thirty' | 'switch' | 'rotate' | 'rest' | 'custom';
/** The bundled cue sounds. */
export type CueSound = 'round' | 'bell' | 'thirty' | 'switch' | 'stop';

export type CueWhen =
  | { at: 'round_start' }
  | { at: 'round_end' }
  | { at: 'rest_start' }
  | { at: 'before_round_end'; seconds: number }
  | { at: 'section_start' }
  | { at: 'section_end' }
  | { at: 'before_section_end'; seconds: number }
  | { at: 'every'; seconds: number }
  | { at: 'once'; seconds: number };
export type WhenKind = CueWhen['at'];

/** Plain-language stand-in for cue priority. */
export type Importance = 'always' | 'normal' | 'optional';

export interface CueRule {
  id: string;
  kind: CueKind;
  name: string;
  sound: CueSound;
  when: CueWhen;
  importance: Importance;
}

export interface GuidedSection {
  id: string;
  kind: SectionKind;
  label: string;
  minutes: number;
  intensity: number;
  music: GuidedMusic[];
  fill?: FillChoice;
  rounds?: Rounds;
  cues: CueRule[];
}

export interface GuidedPlan {
  version: number;
  minutes: number;
  sections: GuidedSection[];
  /** Fingerprint of the timeline this plan last produced. */
  fingerprint?: string;
}

export const CUE_KINDS: Record<CueKind, { label: string; sound: CueSound; importance: Importance; needsRounds?: boolean }> = {
  round_start: { label: 'Round start', sound: 'round', importance: 'always', needsRounds: true },
  round_end: { label: 'Round end', sound: 'bell', importance: 'always', needsRounds: true },
  thirty: { label: '30 seconds', sound: 'thirty', importance: 'normal' },
  switch: { label: 'Switch partners', sound: 'switch', importance: 'normal' },
  rotate: { label: 'Rotate', sound: 'switch', importance: 'normal' },
  rest: { label: 'Rest', sound: 'stop', importance: 'normal', needsRounds: true },
  custom: { label: 'Custom', sound: 'bell', importance: 'normal' },
};
export const CUE_KIND_ORDER: CueKind[] = ['round_start', 'round_end', 'thirty', 'switch', 'rotate', 'rest', 'custom'];

export const CUE_SOUNDS: Record<CueSound, { label: string; type: CueType }> = {
  round: { label: '"Round begins"', type: 'round_start' },
  bell: { label: 'Bell', type: 'round_end' },
  thirty: { label: '"Thirty seconds"', type: 'countdown' },
  switch: { label: '"Switch"', type: 'switch' },
  stop: { label: '"Stop"', type: 'stop' },
};

export const IMPORTANCE: Record<Importance, { label: string; detail: string; priority: CuePriority }> = {
  always: { label: 'Always play', detail: 'Other cues wait for this one', priority: 'high' },
  normal: { label: 'Normal', detail: 'Waits a moment if another cue is talking', priority: 'normal' },
  optional: { label: 'Nice to have', detail: 'Skipped if another cue is talking', priority: 'low' },
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round3 = (v: number) => Math.round(v * 1000) / 1000;

/** "3 min", "1:30", "45 sec": durations only, never class timestamps. */
export function dur(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} sec`;
  if (s % 60 === 0) return `${s / 60} min`;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function describeWhen(w: CueWhen): string {
  switch (w.at) {
    case 'round_start':
      return 'Start of each round';
    case 'round_end':
      return 'End of each round';
    case 'rest_start':
      return 'Start of each rest';
    case 'before_round_end':
      return `${dur(w.seconds)} before each round ends`;
    case 'section_start':
      return 'Start of the section';
    case 'section_end':
      return 'End of the section';
    case 'before_section_end':
      return `${dur(w.seconds)} before the section ends`;
    case 'every':
      return `Every ${dur(w.seconds)}`;
    case 'once':
      return `Once, ${dur(w.seconds)} in`;
  }
}

// ---------------------------------------------------------------- building blocks

export function newPlan(minutes: number): GuidedPlan {
  return { version: GUIDE_VERSION, minutes: clamp(Math.round(minutes), 1, MAX_CLASS_MINUTES), sections: [] };
}

export const roundPeriod = (r: Rounds) => r.workSeconds + r.restSeconds;
/** Class time the rounds occupy: every round plus the rests BETWEEN rounds. */
export const roundsSeconds = (r: Rounds) => r.count * r.workSeconds + Math.max(0, r.count - 1) * r.restSeconds;
/** How many whole rounds fit in a span. */
export const roundsThatFit = (r: Pick<Rounds, 'workSeconds' | 'restSeconds'>, spanSeconds: number) =>
  Math.max(1, Math.floor((spanSeconds + r.restSeconds) / (r.workSeconds + r.restSeconds)));

export function defaultRounds(spanSeconds: number): Rounds {
  const base = { workSeconds: 180, restSeconds: 60 };
  return { ...base, count: roundsThatFit(base, spanSeconds) };
}

export function newCueRule(kind: CueKind, section: Pick<GuidedSection, 'rounds'>): CueRule {
  const k = CUE_KINDS[kind];
  const r = section.rounds;
  let when: CueWhen;
  switch (kind) {
    case 'round_start':
      when = { at: 'round_start' };
      break;
    case 'round_end':
      when = { at: 'round_end' };
      break;
    case 'rest':
      when = { at: 'rest_start' };
      break;
    case 'thirty':
      when = r ? { at: 'before_round_end', seconds: 30 } : { at: 'before_section_end', seconds: 30 };
      break;
    case 'switch':
      when = { at: 'every', seconds: 120 };
      break;
    case 'rotate':
      when = r && r.restSeconds > 0 ? { at: 'rest_start' } : { at: 'every', seconds: 300 };
      break;
    case 'custom':
      when = { at: 'once', seconds: 60 };
      break;
  }
  return { id: newId('rule'), kind, name: kind === 'custom' ? '' : k.label, sound: k.sound, when, importance: k.importance };
}

export function newSection(kind: SectionKind, minutes?: number): GuidedSection {
  const k = SECTION_KINDS[kind];
  const m = Math.max(1, Math.round(minutes ?? k.minutes));
  const s: GuidedSection = { id: newId('gs'), kind, label: kind === 'custom' ? '' : k.label, minutes: m, intensity: k.intensity, music: [], cues: [] };
  if (kind === 'rounds') {
    s.rounds = defaultRounds(m * 60);
    s.cues = [newCueRule('round_start', s), newCueRule('round_end', s)];
  }
  return s;
}

export const sectionTitle = (s: Pick<GuidedSection, 'label' | 'kind'>) => s.label.trim() || SECTION_KINDS[s.kind].label;
export const totalMinutes = (p: GuidedPlan) => p.sections.reduce((a, s) => a + s.minutes, 0);

/** Where each section sits in the class (seconds), in order, clipped to the class length. */
export function sectionSpans(p: GuidedPlan): { section: GuidedSection; start: number; end: number }[] {
  const classEnd = p.minutes * 60;
  const out: { section: GuidedSection; start: number; end: number }[] = [];
  let t = 0;
  for (const s of p.sections) {
    const start = t;
    const end = Math.min(classEnd, t + s.minutes * 60);
    t += s.minutes * 60;
    if (start >= classEnd) break;
    out.push({ section: s, start, end });
  }
  return out;
}

// ---------------------------------------------------------------- music

export interface MusicPiece {
  music: GuidedMusic;
  /** Offset inside the section, seconds. */
  at: number;
  seconds: number;
  /** True if the song was cut at the section's end. */
  cut: boolean;
  /** True if this is a repeat of an earlier song. */
  repeat: boolean;
}

export interface MusicLayout {
  pieces: MusicPiece[];
  /** Length of the chosen songs back to back (no repeats). */
  chosenSeconds: number;
  /** Seconds of the section with music. */
  filledSeconds: number;
  /** Seconds left with no music at the end of the section. */
  quietSeconds: number;
  /** How much of the last song is cut off at the section end. */
  cutSeconds: number;
}

/** Lay a section's songs back to back; repeat them only if the instructor chose to. Never stretches. */
export function layoutMusic(s: Pick<GuidedSection, 'music' | 'fill'>, spanSeconds: number): MusicLayout {
  const pieces: MusicPiece[] = [];
  const chosen = s.music.reduce((a, m) => a + m.durationSeconds, 0);
  let t = 0;
  let i = 0;
  let pass = 0;
  let cut = 0;
  while (s.music.length && spanSeconds - t >= MIN_PIECE_SECONDS && pieces.length < 500) {
    if (i >= s.music.length) {
      if (s.fill !== 'repeat') break;
      i = 0;
      pass += 1;
    }
    const m = s.music[i++]!;
    const len = Math.min(m.durationSeconds, spanSeconds - t);
    const isCut = len < m.durationSeconds - 0.001;
    if (isCut) cut = m.durationSeconds - len;
    pieces.push({ music: m, at: round3(t), seconds: round3(len), cut: isCut, repeat: pass > 0 });
    t += len;
  }
  return { pieces, chosenSeconds: round3(chosen), filledSeconds: round3(t), quietSeconds: round3(Math.max(0, spanSeconds - t)), cutSeconds: round3(cut) };
}

// ---------------------------------------------------------------- cues

/** Class-time offsets (seconds from the section start) at which a rule fires. Always an evenly spaced series. */
export function cueOffsets(rule: CueRule, spanSeconds: number, rounds?: Rounds): number[] {
  const w = rule.when;
  const out: number[] = [];
  const within = (t: number, inclusiveEnd = false) => t >= -1e-6 && (inclusiveEnd ? t <= spanSeconds + 1e-6 : t < spanSeconds - 1e-6);
  const perRound = (offset: number, count: number, inclusiveEnd = false) => {
    if (!rounds) return;
    const p = roundPeriod(rounds);
    for (let k = 0; k < count; k++) {
      const t = k * p + offset;
      if (within(t, inclusiveEnd)) out.push(t);
    }
  };
  switch (w.at) {
    case 'round_start':
      perRound(0, rounds?.count ?? 0);
      break;
    case 'round_end':
      perRound(rounds?.workSeconds ?? 0, rounds?.count ?? 0, true);
      break;
    case 'rest_start':
      if (rounds && rounds.restSeconds > 0) perRound(rounds.workSeconds, rounds.count - 1);
      break;
    case 'before_round_end':
      if (rounds && w.seconds < rounds.workSeconds) perRound(rounds.workSeconds - w.seconds, rounds.count);
      break;
    case 'section_start':
      out.push(0);
      break;
    case 'section_end':
      out.push(spanSeconds);
      break;
    case 'before_section_end':
      if (w.seconds < spanSeconds) out.push(spanSeconds - w.seconds);
      break;
    case 'every':
      if (w.seconds >= 5) for (let t = w.seconds; within(t); t += w.seconds) out.push(t);
      break;
    case 'once':
      if (within(w.seconds)) out.push(w.seconds);
      break;
  }
  return out.map(round3);
}

/** One timeline cue (with a repeat if the rule fires more than once), or null if it never fires. */
export function compileCue(rule: CueRule, sectionId: string, start: number, spanSeconds: number, rounds?: Rounds): SoundtrackCue | null {
  const times = cueOffsets(rule, spanSeconds, rounds).map((t) => round3(start + t));
  if (!times.length) return null;
  const type = CUE_SOUNDS[rule.sound].type;
  const name = rule.name.trim() || CUE_KINDS[rule.kind].label;
  const cue: SoundtrackCue = {
    id: `${sectionId}~${rule.id}`,
    timeSeconds: times[0]!,
    type,
    priority: IMPORTANCE[rule.importance].priority,
    duckTo: CUE_TYPES[type].duckTo,
    label: name,
  };
  if (times.length > 1) {
    cue.repeatEverySeconds = round3(times[1]! - times[0]!);
    cue.repeatUntilSeconds = times.at(-1)!;
  }
  return cue;
}

// ---------------------------------------------------------------- compile

/** Compile the plan into a ClassSoundtrack. `base` supplies the name and music level. */
export function buildSoundtrack(base: Pick<ClassSoundtrack, 'name' | 'musicGain'>, plan: GuidedPlan): ClassSoundtrack {
  const shell = newSoundtrack(base.name, plan.minutes * 60);
  const classSeconds = shell.durationSeconds;
  const sections: SoundtrackSection[] = [];
  const tracks: SoundtrackTrack[] = [];
  const cues: SoundtrackCue[] = [];
  for (const { section: s, start, end } of sectionSpans(plan)) {
    const span = end - start;
    sections.push({ id: s.id, label: sectionTitle(s), startSeconds: round3(start), endSeconds: round3(end) });
    layoutMusic(s, span).pieces.forEach((p, k) => {
      tracks.push(
        normalizeTrack(
          {
            id: `${s.id}~m${k}`,
            assetId: p.music.assetId,
            label: p.music.label,
            assetDurationSeconds: p.music.durationSeconds,
            startSeconds: start + p.at,
            sourceOffsetSeconds: 0,
            durationSeconds: p.seconds,
            gain: 1,
            fadeInSeconds: 0,
            fadeOutSeconds: p.cut ? Math.min(CUT_FADE_SECONDS, p.seconds / 2) : 0,
          },
          classSeconds,
        ),
      );
    });
    for (const rule of s.cues) {
      const c = compileCue(rule, s.id, start, span, s.rounds);
      if (c) cues.push(c);
    }
  }
  const doc: ClassSoundtrack = { ...shell, musicGain: base.musicGain, sections, tracks, cues };
  const guide: GuidedPlan = { ...plan, version: GUIDE_VERSION, fingerprint: fingerprint(doc) };
  return { ...doc, guide: guide as unknown as Record<string, unknown> };
}

// ---------------------------------------------------------------- change detection

/** Stable JSON: sorted keys, undefined dropped (stored documents come back with keys reordered). */
function canon(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canon(o[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

/** Fingerprint of the timeline (length, music, cues, sections); name and music level are excluded. */
export function fingerprint(s: Pick<ClassSoundtrack, 'durationSeconds' | 'tracks' | 'cues' | 'sections'>): string {
  const text = canon({ d: s.durationSeconds, t: s.tracks, c: s.cues, s: s.sections });
  let h1 = 0x811c9dc5;
  let h2 = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
    h2 = (Math.imul(h2, 31) + c) >>> 0;
  }
  return `${text.length.toString(36)}-${h1.toString(36)}-${h2.toString(36)}`;
}

// ---------------------------------------------------------------- reading stored plans

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function readWhen(v: unknown): CueWhen | null {
  if (!isObj(v) || typeof v.at !== 'string') return null;
  switch (v.at) {
    case 'round_start':
    case 'round_end':
    case 'rest_start':
    case 'section_start':
    case 'section_end':
      return { at: v.at };
    case 'before_round_end':
    case 'before_section_end':
    case 'every':
    case 'once':
      return isNum(v.seconds) && v.seconds >= 0 ? { at: v.at, seconds: v.seconds } : null;
    default:
      return null;
  }
}

function readRule(v: unknown): CueRule | null {
  if (!isObj(v) || typeof v.id !== 'string' || typeof v.kind !== 'string' || !(v.kind in CUE_KINDS)) return null;
  if (typeof v.sound !== 'string' || !(v.sound in CUE_SOUNDS) || typeof v.importance !== 'string' || !(v.importance in IMPORTANCE)) return null;
  const when = readWhen(v.when);
  if (!when) return null;
  return { id: v.id, kind: v.kind as CueKind, name: typeof v.name === 'string' ? v.name : '', sound: v.sound as CueSound, when, importance: v.importance as Importance };
}

function readSection(v: unknown): GuidedSection | null {
  if (!isObj(v) || typeof v.id !== 'string' || typeof v.kind !== 'string' || !(v.kind in SECTION_KINDS)) return null;
  if (!isNum(v.minutes) || v.minutes <= 0 || !Array.isArray(v.music) || !Array.isArray(v.cues)) return null;
  const music: GuidedMusic[] = [];
  for (const m of v.music) {
    if (!isObj(m) || typeof m.assetId !== 'string' || !isNum(m.durationSeconds) || m.durationSeconds <= 0) return null;
    music.push({ assetId: m.assetId, label: typeof m.label === 'string' ? m.label : 'Song', durationSeconds: m.durationSeconds });
  }
  const cues: CueRule[] = [];
  for (const c of v.cues) {
    const r = readRule(c);
    if (!r) return null;
    cues.push(r);
  }
  const s: GuidedSection = {
    id: v.id,
    kind: v.kind as SectionKind,
    label: typeof v.label === 'string' ? v.label : '',
    minutes: v.minutes,
    intensity: isNum(v.intensity) ? clamp(Math.round(v.intensity), 1, 5) : SECTION_KINDS[v.kind as SectionKind].intensity,
    music,
    cues,
  };
  if (v.fill === 'repeat' || v.fill === 'quiet') s.fill = v.fill;
  const r = v.rounds;
  if (isObj(r) && isNum(r.workSeconds) && r.workSeconds > 0 && isNum(r.restSeconds) && r.restSeconds >= 0 && isNum(r.count) && r.count >= 1) {
    s.rounds = { workSeconds: r.workSeconds, restSeconds: r.restSeconds, count: Math.round(r.count) };
  }
  return s;
}

/** The stored plan, or null if absent or unreadable (never guessed). */
export function readGuide(doc: Pick<ClassSoundtrack, 'guide'>): GuidedPlan | null {
  const g = doc.guide;
  if (!isObj(g) || g.version !== GUIDE_VERSION || !isNum(g.minutes) || g.minutes <= 0 || !Array.isArray(g.sections)) return null;
  const sections: GuidedSection[] = [];
  for (const x of g.sections) {
    const s = readSection(x);
    if (!s) return null;
    sections.push(s);
  }
  return { version: GUIDE_VERSION, minutes: g.minutes, sections, ...(typeof g.fingerprint === 'string' ? { fingerprint: g.fingerprint } : {}) };
}

/** A best-effort plan for a class built on the timeline (sections become custom sections, their music is kept). */
export function derivePlan(doc: ClassSoundtrack): GuidedPlan {
  const plan = newPlan(doc.durationSeconds / 60);
  const secs = [...doc.sections].sort((a, b) => a.startSeconds - b.startSeconds);
  const tracks = [...doc.tracks].sort((a, b) => a.startSeconds - b.startSeconds);
  const spans = secs.length ? secs.map((x) => ({ label: x.label, start: x.startSeconds, end: x.endSeconds })) : tracks.length ? [{ label: 'Class', start: 0, end: doc.durationSeconds }] : [];
  plan.sections = spans.map((x) => ({
    ...newSection('custom', Math.max(1, Math.round((x.end - x.start) / 60))),
    label: x.label,
    music: tracks
      .filter((t) => t.startSeconds >= x.start - 1e-6 && t.startSeconds < x.end)
      .map((t) => ({ assetId: t.assetId, label: t.label, durationSeconds: t.assetDurationSeconds })),
  }));
  return plan;
}

export interface GuidedState {
  plan: GuidedPlan;
  /** The timeline no longer matches the guided plan (changed in Advanced Edit, or built there). */
  diverged: boolean;
}

export function guidedState(doc: ClassSoundtrack): GuidedState {
  const g = readGuide(doc);
  if (g) return { plan: g, diverged: g.fingerprint !== fingerprint(doc) };
  const empty = !doc.tracks.length && !doc.cues.length && !doc.sections.length;
  return { plan: derivePlan(doc), diverged: !empty };
}
