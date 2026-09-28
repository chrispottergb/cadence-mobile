import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, View } from 'react-native';

import { cueSeconds, type CueId, listPlayable } from '@/audiolab/assets';
import { loadSoundtrack } from '@/data/soundtracks';
import { isClassActive, seekBy, seekTo, startClass, stopClass, togglePlay, useClassPlayback } from '@/playback/session';
import { type ClassSoundtrack, CUE_TYPES, positionAt, sectionAt, toPlan } from '@/soundtrack/model';
import { Button, colors, radius, Screen, space, Text } from '@/ui';

/**
 * Class-running view. Not an editor: big, high-contrast and glove-friendly,
 * readable from several feet away. It drives the app-wide class player, so
 * leaving this screen never stops the class (the mini-player keeps it).
 */
const cueSec = (a: string) => cueSeconds(a as CueId);

/** "4:05" countdown. */
export function countdown(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds - 1e-6));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function RunningClass({ id }: { id: string }) {
  const router = useRouter();
  const cls = useClassPlayback();
  const [doc, setDoc] = useState<ClassSoundtrack | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  useFocusEffect(
    useCallback(() => {
      void loadSoundtrack(id).then((r) => (r.value ? setDoc(r.value.soundtrack) : setError(r.error ?? 'Could not load this class.')));
    }, [id]),
  );

  const plan = useMemo(() => (doc ? toPlan(doc, cueSec) : null), [doc]);
  const mine = cls.soundtrackId === id;
  const active = mine && isClassActive(cls);
  const snap = mine ? cls.snapshot : null;
  const pos = snap?.positionSeconds ?? 0;

  // The screen stays on while this class runs here, so it can be read from across the room.
  useEffect(() => {
    if (!active) return;
    const tag = `class-${id}`;
    void activateKeepAwakeAsync(tag).catch(() => undefined);
    return () => void deactivateKeepAwake(tag).catch(() => undefined);
  }, [active, id]);

  const start = async () => {
    if (!doc || !plan) return;
    setStarting(true);
    const library = (await listPlayable()).filter((t) => t.demo === undefined);
    setStarting(false);
    void startClass({ soundtrackId: id, title: doc.name, plan, sections: doc.sections, musicGain: doc.musicGain, library, fromSeconds: 0, engineKind: 'media-player' });
  };

  const end = () =>
    Alert.alert('End the class?', 'The music and cues stop.', [
      { text: 'Keep going', style: 'cancel' },
      { text: 'End class', style: 'destructive', onPress: () => void stopClass().then(() => router.back()) },
    ]);

  if (!doc || !plan) {
    return (
      <Screen>
        <Text muted>{error ?? 'Loading...'}</Text>
        <Button title="Back" variant="ghost" onPress={() => router.back()} />
      </Screen>
    );
  }

  const ordered = [...doc.sections].sort((a, b) => a.startSeconds - b.startSeconds);
  const section = sectionAt(doc, pos);
  const next = ordered.find((x) => x.startSeconds > pos + 0.5) ?? null;
  const sectionLeft = section ? section.endSeconds - pos : (next?.startSeconds ?? doc.durationSeconds) - pos;
  const track = doc.tracks.find((t) => pos >= t.startSeconds && pos < t.startSeconds + t.durationSeconds);
  const nextCue = active ? positionAt(plan, pos).nextCue : null;
  const cueDoc = nextCue ? doc.cues.find((c) => c.id === nextCue.cueId) : undefined;
  const cueName = cueDoc ? cueDoc.label || CUE_TYPES[cueDoc.type].label : null;
  const state = snap?.state;
  const playing = state === 'PLAYING';
  const finished = state === 'COMPLETED';

  return (
    <Screen style={{ backgroundColor: '#000' }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Pressable testID="run-back" accessibilityRole="button" onPress={() => router.back()} hitSlop={12} style={{ minHeight: 48, justifyContent: 'center' }}>
          <Text style={{ color: colors.accent, fontWeight: '700', fontSize: 18 }}>‹ Back</Text>
        </Pressable>
        <Text muted numberOfLines={1} style={{ flex: 1, textAlign: 'right' }}>
          {doc.name}
        </Text>
      </View>

      <View style={{ flex: 1, justifyContent: 'center', gap: space.lg }}>
        <View style={{ alignItems: 'center' }}>
          <Text testID="run-section" numberOfLines={1} adjustsFontSizeToFit style={{ fontSize: 44, lineHeight: 52, fontWeight: '800', textTransform: 'uppercase' }}>
            {finished ? 'Class complete' : (section?.label ?? (active ? 'Class' : 'Ready'))}
          </Text>
          <Text testID="run-remaining" style={{ fontSize: 96, lineHeight: 104, fontWeight: '800', color: colors.accent, fontVariant: ['tabular-nums'] }}>
            {active && !finished ? countdown(sectionLeft) : '--:--'}
          </Text>
          <Text muted style={{ fontSize: 18 }}>
            {active && !finished ? 'left in this section' : ' '}
          </Text>
        </View>

        <View style={{ gap: space.sm }}>
          <InfoRow testID="run-track" label="Music" value={track?.label ?? (active ? 'Quiet' : '-')} />
          <InfoRow testID="run-cue" label="Next cue" value={nextCue && cueName ? `${cueName} in ${countdown(nextCue.timeSeconds - pos)}` : 'None'} />
          <InfoRow testID="run-next" label="Next section" value={next ? `${next.label} in ${countdown(next.startSeconds - pos)}` : 'Last section'} />
        </View>

        {state === 'INTERRUPTED' ? (
          <Text style={{ color: colors.accent, fontSize: 20, fontWeight: '700', textAlign: 'center' }}>Paused by the phone. Tap RESUME.</Text>
        ) : null}
        {mine && cls.message && !cls.preparing ? <Text style={{ color: colors.danger, fontSize: 18, textAlign: 'center' }}>{cls.message}</Text> : null}
      </View>

      {!active || finished ? (
        <BigButton testID="run-start" label={cls.preparing && mine ? 'GETTING READY...' : finished ? 'START AGAIN' : 'START CLASS'} onPress={() => void start()} disabled={starting || (mine && cls.preparing)} primary />
      ) : (
        <View style={{ gap: space.sm }}>
          <BigButton testID="run-toggle" label={cls.preparing ? 'GETTING READY...' : playing ? 'PAUSE' : 'RESUME'} onPress={togglePlay} disabled={cls.preparing} primary />
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <BigButton testID="run-back30" label="◀ 30 SEC" onPress={() => seekBy(-30)} />
            <BigButton testID="run-fwd30" label="+30 SEC ▶" onPress={() => seekBy(30)} />
          </View>
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <BigButton testID="run-next-section" label="NEXT SECTION ▶" onPress={() => next && seekTo(next.startSeconds)} disabled={!next} />
            <BigButton testID="run-end" label="END" onPress={end} flex={0.5} />
          </View>
        </View>
      )}
    </Screen>
  );
}

function InfoRow({ label, value, testID }: { label: string; value: string; testID?: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space.md, paddingVertical: space.xs, borderBottomWidth: 1, borderBottomColor: colors.border }}>
      <Text variant="label" muted style={{ width: 110 }}>
        {label}
      </Text>
      <Text testID={testID} numberOfLines={1} style={{ flex: 1, fontSize: 22, lineHeight: 28, fontWeight: '700' }}>
        {value}
      </Text>
    </View>
  );
}

function BigButton({ label, onPress, disabled, primary, testID, flex = 1 }: { label: string; onPress: () => void; disabled?: boolean; primary?: boolean; testID?: string; flex?: number }) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        flex,
        minHeight: primary ? 96 : 76,
        borderRadius: radius.lg,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: primary ? colors.accent : colors.surfaceRaised,
        borderWidth: primary ? 0 : 2,
        borderColor: colors.border,
        opacity: disabled ? 0.4 : pressed ? 0.8 : 1,
      })}
    >
      <Text style={{ fontSize: primary ? 30 : 22, fontWeight: '800', color: primary ? colors.accentText : colors.text }}>{label}</Text>
    </Pressable>
  );
}
