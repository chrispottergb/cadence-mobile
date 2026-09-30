import { View } from 'react-native';

import {
  CUE_KIND_ORDER,
  CUE_KINDS,
  CUE_SOUNDS,
  type CueKind,
  cueOffsets,
  type CueRule,
  type CueSound,
  type CueWhen,
  describeWhen,
  dur,
  type GuidedSection,
  IMPORTANCE,
  type Importance,
  type WhenKind,
} from '@/soundtrack/guided';
import { Button, Field, space, Text } from '@/ui';

import { Chip, ChipRow, Sheet, Stepper } from './parts';

/** Timing options offered for a section; round-based ones only when the section has rounds. */
function whenOptions(section: GuidedSection): WhenKind[] {
  const r = section.rounds;
  return [
    ...(r ? (['round_start', 'round_end', 'before_round_end', 'every_round'] as WhenKind[]) : []),
    ...(r && r.restSeconds > 0 ? (['rest_start'] as WhenKind[]) : []),
    'every',
    'once',
    'before_section_end',
    'section_start',
    'section_end',
  ];
}

const WHEN_LABELS: Record<WhenKind, string> = {
  round_start: 'Each round start',
  round_end: 'Each round end',
  rest_start: 'Each rest',
  before_round_end: 'Before each round ends',
  section_start: 'Section start',
  section_end: 'Section end',
  before_section_end: 'Before section ends',
  every: 'Every...',
  every_round: 'Every... during work rounds',
  once: 'Once, at...',
};

function whenFor(at: WhenKind, prev: CueWhen): CueWhen {
  // Carry the number over only within the same kind of timing ("before..." to "before...").
  const family = (k: WhenKind) => (k.startsWith('before_') ? 'before' : k);
  const seconds = 'seconds' in prev && family(prev.at) === family(at) ? prev.seconds : undefined;
  switch (at) {
    case 'before_round_end':
    case 'before_section_end':
      return { at, seconds: seconds ?? 30 };
    case 'every_round':
    case 'every':
      return { at, seconds: seconds ?? 120 };
    case 'once':
      return { at, seconds: seconds ?? 60 };
    default:
      return { at };
  }
}

/** Seconds step and minimum for the number that goes with a timing. */
const STEP: Partial<Record<WhenKind, { step: number; min: number }>> = {
  before_round_end: { step: 5, min: 5 },
  before_section_end: { step: 5, min: 5 },
  every: { step: 30, min: 30 },
  every_round: { step: 15, min: 15 },
  once: { step: 30, min: 0 },
};

/** Step 1: pick what kind of cue. */
export function AddCueSheet({ section, onPick, onClose }: { section: GuidedSection | null; onPick: (k: CueKind) => void; onClose: () => void }) {
  return (
    <Sheet visible={!!section} onClose={onClose} title="Add a cue" footer={<Button title="Cancel" variant="ghost" onPress={onClose} />}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
        {CUE_KIND_ORDER.map((k) => (
          <View key={k} style={{ width: '48%' }}>
            <Button testID={`cue-kind-${k}`} title={CUE_KINDS[k].label} variant="secondary" onPress={() => onPick(k)} />
          </View>
        ))}
      </View>
      {section && !section.rounds ? (
        <Text muted variant="caption">
          Round start, Round end and Rest set up rounds for this section (you can change them).
        </Text>
      ) : null}
    </Sheet>
  );
}

/** Step 2: name, sound, timing and importance of one cue. */
export function CueEditSheet({
  section,
  spanSeconds,
  rule,
  onChange,
  onRemove,
  onClose,
}: {
  section: GuidedSection | null;
  spanSeconds: number;
  rule: CueRule | null;
  onChange: (r: CueRule) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  if (!section || !rule) return null;
  const w = rule.when;
  const step = STEP[w.at];
  const times = cueOffsets(rule, spanSeconds, section.rounds).length;
  const set = (patch: Partial<CueRule>) => onChange({ ...rule, ...patch });

  return (
    <Sheet
      visible
      onClose={onClose}
      title={rule.name.trim() || CUE_KINDS[rule.kind].label}
      footer={
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <View style={{ flex: 1 }}>
            <Button testID="cue-remove" title="Remove" variant="secondary" onPress={onRemove} />
          </View>
          <View style={{ flex: 2 }}>
            <Button testID="cue-done" title="Done" disabled={rule.speechText !== undefined && !rule.speechText.trim()} onPress={onClose} />
          </View>
        </View>
      }
    >
      <Text testID="cue-summary" style={{ fontWeight: '700' }}>
        {describeWhen(w)} · {times === 0 ? 'never plays in this section' : times === 1 ? 'plays once' : `plays ${times} times`}
      </Text>

      <Text variant="label" muted>
        Name
      </Text>
      <Field testID="cue-name" value={rule.name} onChangeText={(v) => set({ name: v })} placeholder={CUE_KINDS[rule.kind].label === 'Custom' ? 'e.g. Water break' : CUE_KINDS[rule.kind].label} maxLength={40} />
      {rule.speechText !== undefined ? <Field accessibilityLabel="Spoken instruction" value={rule.speechText} onChangeText={(speechText) => set({ speechText })} maxLength={240} multiline /> : null}

      <Text variant="label" muted>
        When
      </Text>
      <ChipRow>
        {whenOptions(section).map((k) => (
          <Chip key={k} testID={`cue-when-${k}`} label={WHEN_LABELS[k]} selected={w.at === k} onPress={() => set({ when: whenFor(k, w) })} />
        ))}
      </ChipRow>
      {step && 'seconds' in w ? (
        <Stepper
          testID="cue-seconds"
          value={dur(w.seconds)}
          minusDisabled={w.seconds - step.step < step.min}
          onMinus={() => set({ when: { ...w, seconds: Math.max(step.min, w.seconds - step.step) } })}
          onPlus={() => set({ when: { ...w, seconds: w.seconds + step.step } })}
        />
      ) : null}

      <Text variant="label" muted>
        Sound
      </Text>
      <ChipRow>
        <Chip label="Speak text" selected={rule.speechText !== undefined} onPress={() => set({ speechText: rule.speechText ?? rule.name })} />
        {(Object.keys(CUE_SOUNDS) as CueSound[]).map((k) => (
          <Chip key={k} testID={`cue-sound-${k}`} label={CUE_SOUNDS[k].label} selected={rule.speechText === undefined && rule.sound === k} onPress={() => set({ sound: k, speechText: undefined })} />
        ))}
      </ChipRow>

      <Text variant="label" muted>
        If two cues happen together
      </Text>
      <ChipRow>
        {(Object.keys(IMPORTANCE) as Importance[]).map((k) => (
          <Chip key={k} testID={`cue-importance-${k}`} label={IMPORTANCE[k].label} selected={rule.importance === k} onPress={() => set({ importance: k })} />
        ))}
      </ChipRow>
      <Text muted variant="caption">
        {IMPORTANCE[rule.importance].detail}
      </Text>
    </Sheet>
  );
}
