import type { PropsWithChildren, ReactNode } from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';

import type { SectionKind } from '@/soundtrack/guided';
import { colors, radius, space, Text } from '@/ui';

/**
 * Large, glove-friendly controls shared by the Guided Builder and the
 * running view. Every tap target is at least 52 pt.
 */
export const KIND_COLORS: Record<SectionKind, string> = {
  warmup: '#E8B84A',
  technique: '#4A90E2',
  drilling: '#9B6BE8',
  rounds: '#E5484D',
  conditioning: '#F07F3C',
  cooldown: '#3DD68C',
  custom: '#8A96A3',
};

export function Stepper({ value, onMinus, onPlus, testID, minusDisabled }: { value: string; onMinus: () => void; onPlus: () => void; testID?: string; minusDisabled?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
      <RoundButton label="−" onPress={onMinus} testID={testID ? `${testID}-minus` : undefined} disabled={minusDisabled} accessibilityLabel="Less" />
      <Text testID={testID ? `${testID}-value` : undefined} variant="title" style={{ minWidth: 88, textAlign: 'center' }}>
        {value}
      </Text>
      <RoundButton label="+" onPress={onPlus} testID={testID ? `${testID}-plus` : undefined} accessibilityLabel="More" />
    </View>
  );
}

export function RoundButton({ label, onPress, testID, disabled, accessibilityLabel }: { label: string; onPress: () => void; testID?: string; disabled?: boolean; accessibilityLabel?: string }) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => ({
        width: 52,
        height: 52,
        borderRadius: 26,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surfaceRaised,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: disabled ? 0.35 : pressed ? 0.8 : 1,
      })}
    >
      <Text style={{ fontSize: 26, lineHeight: 30, fontWeight: '700' }}>{label}</Text>
    </Pressable>
  );
}

export function Chip({ label, selected, onPress, testID }: { label: string; selected: boolean; onPress: () => void; testID?: string }) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 52,
        minWidth: 64,
        paddingHorizontal: space.md,
        borderRadius: radius.md,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: selected ? colors.accent : colors.surfaceRaised,
        borderWidth: 1,
        borderColor: selected ? colors.accent : colors.border,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <Text style={{ fontWeight: '700', color: selected ? colors.accentText : colors.text }}>{label}</Text>
    </Pressable>
  );
}

export function ChipRow({ children }: PropsWithChildren) {
  return <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>{children}</View>;
}

/** LOW .. HIGH as five big segments. */
export function IntensityBar({ value, onChange, testID }: { value: number; onChange: (v: number) => void; testID?: string }) {
  return (
    <View style={{ gap: space.xs }}>
      <View style={{ flexDirection: 'row', gap: 4 }}>
        {[1, 2, 3, 4, 5].map((v) => (
          <Pressable
            key={v}
            testID={testID ? `${testID}-${v}` : undefined}
            accessibilityRole="adjustable"
            accessibilityLabel={`Intensity ${v} of 5`}
            accessibilityState={{ selected: v === value }}
            onPress={() => onChange(v)}
            style={{ flex: 1, height: 44, borderRadius: radius.sm, backgroundColor: v <= value ? intensityColor(v) : colors.surfaceRaised, borderWidth: 1, borderColor: colors.border }}
          />
        ))}
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text variant="label" muted>
          Low
        </Text>
        <Text variant="label" muted>
          High
        </Text>
      </View>
    </View>
  );
}

const intensityColor = (v: number) => ['#3DD68C', '#9BD65A', '#E8B84A', '#F07F3C', '#E5484D'][v - 1]!;

/** The class as a bar: one coloured block per section, proportional to its minutes. */
export function DurationBar({ parts, total, testID }: { parts: { key: string; kind: SectionKind; minutes: number }[]; total: number; testID?: string }) {
  const used = parts.reduce((a, p) => a + p.minutes, 0);
  const scale = Math.max(total, used) || 1;
  return (
    <View testID={testID} style={{ height: 20, borderRadius: radius.sm, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border, flexDirection: 'row', overflow: 'hidden' }}>
      {parts.map((p) => (
        <View key={p.key} style={{ width: `${(p.minutes / scale) * 100}%`, backgroundColor: KIND_COLORS[p.kind], borderRightWidth: 2, borderRightColor: colors.bg }} />
      ))}
      {used > total ? <View style={{ position: 'absolute', left: `${(total / scale) * 100}%`, top: 0, bottom: 0, width: 3, backgroundColor: colors.text }} /> : null}
    </View>
  );
}

/** Bottom sheet. */
export function Sheet({ visible, onClose, title, children, footer }: { visible: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: '#0008' }} onPress={onClose} accessibilityLabel="Close" />
      <View style={{ maxHeight: '85%', backgroundColor: colors.surface, padding: space.lg, gap: space.sm, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg }}>
        <Text variant="title">{title}</Text>
        <ScrollView contentContainerStyle={{ gap: space.sm, paddingBottom: space.sm }} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
        {footer}
      </View>
    </Modal>
  );
}
