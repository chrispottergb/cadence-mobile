/**
 * Starting points for the Guided Builder. Convenience only: a template just
 * fills in sections, which the instructor can then change freely. Nothing
 * here is part of the timeline model.
 */
import { type GuidedSection, newSection, type SectionKind } from './guided';

export interface ClassTemplate {
  key: string;
  title: string;
  blurb: string;
  sections: { kind: SectionKind; minutes: number; label?: string }[];
}

export const TEMPLATES: ClassTemplate[] = [
  {
    key: 'standard60',
    title: 'Standard 60',
    blurb: 'Warm-up, technique, drilling, rounds, cooldown',
    sections: [
      { kind: 'warmup', minutes: 10 },
      { kind: 'technique', minutes: 15 },
      { kind: 'drilling', minutes: 15 },
      { kind: 'rounds', minutes: 15 },
      { kind: 'cooldown', minutes: 5 },
    ],
  },
  {
    key: 'openmat',
    title: 'Open Mat',
    blurb: 'Short warm-up, then rounds',
    sections: [
      { kind: 'warmup', minutes: 5 },
      { kind: 'rounds', minutes: 50 },
      { kind: 'cooldown', minutes: 5 },
    ],
  },
  {
    key: 'kids',
    title: 'Kids Class',
    blurb: 'Short blocks with a game',
    sections: [
      { kind: 'warmup', minutes: 10 },
      { kind: 'technique', minutes: 10 },
      { kind: 'drilling', minutes: 10 },
      { kind: 'custom', minutes: 10, label: 'Games' },
      { kind: 'cooldown', minutes: 5 },
    ],
  },
  {
    key: 'competition',
    title: 'Competition Training',
    blurb: 'Hard drilling and lots of rounds',
    sections: [
      { kind: 'warmup', minutes: 15 },
      { kind: 'drilling', minutes: 20 },
      { kind: 'rounds', minutes: 40 },
      { kind: 'conditioning', minutes: 10 },
      { kind: 'cooldown', minutes: 5 },
    ],
  },
  {
    key: 'conditioning',
    title: 'Conditioning',
    blurb: 'Warm-up, one long block, cooldown',
    sections: [
      { kind: 'warmup', minutes: 5 },
      { kind: 'conditioning', minutes: 35 },
      { kind: 'cooldown', minutes: 5 },
    ],
  },
];

export const templateMinutes = (t: ClassTemplate) => t.sections.reduce((a, s) => a + s.minutes, 0);

/**
 * Sections for a template, scaled to the class length when it differs from
 * the template's own. Whole minutes; the rounding difference goes to the
 * longest section so the total always equals the class length.
 */
export function applyTemplate(t: ClassTemplate, classMinutes: number): GuidedSection[] {
  const own = templateMinutes(t);
  const target = Math.max(t.sections.length, Math.round(classMinutes));
  const mins = t.sections.map((s) => (own === target ? s.minutes : Math.max(1, Math.round((s.minutes * target) / own))));
  const diff = target - mins.reduce((a, m) => a + m, 0);
  if (diff !== 0) {
    const i = mins.indexOf(Math.max(...mins));
    mins[i] = Math.max(1, mins[i]! + diff);
  }
  return t.sections.map((s, i) => {
    const sec = newSection(s.kind, mins[i]);
    return s.label ? { ...sec, label: s.label } : sec;
  });
}
