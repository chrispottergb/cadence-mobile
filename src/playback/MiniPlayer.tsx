import { useRouter } from 'expo-router';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { formatClock } from '@/audiolab/timeline';
import { colors, space, Text } from '@/ui';

import { isClassActive, stopClass, togglePlay, useClassPlayback } from './session';

const clock = (s: number) => formatClock(s).replace(/\.\d$/, '');

/**
 * Always-visible bar while a class soundtrack is playing, on every screen:
 * what is playing, where in the class, and play/pause/stop. Tap the title to
 * open that soundtrack in the Builder.
 */
export function MiniPlayer() {
  const p = useClassPlayback();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  if (!isClassActive(p)) return null;
  const snap = p.snapshot;
  const pos = snap?.positionSeconds ?? 0;
  const section = p.sections.find((x) => pos >= x.startSeconds && pos < x.endSeconds)?.label;
  const playing = snap?.state === 'PLAYING';
  const status = p.preparing ? 'Preparing...' : snap?.state === 'INTERRUPTED' ? 'Paused by the phone' : snap?.state === 'COMPLETED' ? 'Finished' : playing ? 'Playing' : 'Paused';
  const progress = p.totalSeconds > 0 ? Math.min(1, pos / p.totalSeconds) : 0;

  return (
    <View testID="mini-player" style={{ backgroundColor: colors.surfaceRaised, borderTopWidth: 1, borderTopColor: colors.border, paddingBottom: insets.bottom }}>
      <View style={{ height: 3, backgroundColor: colors.border }}>
        <View style={{ height: 3, width: `${progress * 100}%`, backgroundColor: colors.accent }} />
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.md, paddingVertical: space.sm, gap: space.sm }}>
        <Pressable
          style={{ flex: 1 }}
          onPress={() => p.soundtrackId && router.push({ pathname: '/soundtracks/[id]', params: { id: p.soundtrackId } })}
          accessibilityLabel="Open this class soundtrack"
        >
          <Text numberOfLines={1} style={{ fontWeight: '700' }}>
            {p.title || 'Class soundtrack'}
          </Text>
          <Text variant="caption" muted numberOfLines={1}>
            {status} · {clock(pos)} / {clock(p.totalSeconds)}
            {section ? ` · ${section}` : ''}
          </Text>
        </Pressable>
        <Pressable
          testID="mini-toggle"
          onPress={togglePlay}
          disabled={p.preparing}
          accessibilityLabel={playing ? 'Pause' : 'Play'}
          style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', opacity: p.preparing ? 0.5 : 1 }}
        >
          <Text style={{ color: colors.accentText, fontWeight: '800', fontSize: 18 }}>{playing ? '||' : '▶'}</Text>
        </Pressable>
        <Pressable
          testID="mini-stop"
          onPress={() => void stopClass()}
          accessibilityLabel="Stop"
          style={{ width: 52, height: 52, borderRadius: 26, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' }}
        >
          <Text style={{ fontWeight: '800', fontSize: 16 }}>■</Text>
        </Pressable>
      </View>
      {p.message && !p.preparing ? (
        <Text variant="caption" style={{ color: colors.danger, paddingHorizontal: space.md, paddingBottom: space.xs }}>
          {p.message}
        </Text>
      ) : null}
    </View>
  );
}
