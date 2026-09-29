import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import type { PlayableTrack } from '@/audiolab/assets';
import { getPlaybackUrl } from '@/music/client';
import { dur, type GuidedSection, INTENSITY_WORDS, SECTION_KINDS, sectionTitle } from '@/soundtrack/guided';
import { Button, colors, Field, radius, space, Text } from '@/ui';

import { Sheet } from './parts';

export interface GenerateRequest {
  description: string;
  style: string;
  seconds: number;
}

/** What a "Generate music for this section" request carries: type, intensity, length and style. */
export function generateRequest(section: GuidedSection, spanSeconds: number, style: string): GenerateRequest {
  const kind = SECTION_KINDS[section.kind].label.toLowerCase();
  const title = sectionTitle(section);
  const what = section.kind === 'custom' ? `"${title}"` : kind;
  return {
    description: `Music for the ${what} part of a martial arts class, ${INTENSITY_WORDS[section.intensity]!.toLowerCase()} intensity, about ${dur(spanSeconds)}`,
    style,
    seconds: Math.round(spanSeconds),
  };
}

export function MusicPicker({
  section,
  spanSeconds,
  filledSeconds,
  library,
  loading,
  onChoose,
  onGenerate,
  onClose,
}: {
  section: GuidedSection | null;
  spanSeconds: number;
  filledSeconds: number;
  library: PlayableTrack[];
  loading: boolean;
  onChoose: (t: PlayableTrack) => void;
  onGenerate: (r: GenerateRequest) => void;
  onClose: () => void;
}) {
  // Remounted (keyed) for each section, so these start fresh every time.
  const [style, setStyle] = useState(() => (section ? SECTION_KINDS[section.kind].style : ''));
  const [error, setError] = useState<string | null>(null);
  // One preview player for the sheet; switching songs replaces its source.
  const player = useAudioPlayer(null);
  const status = useAudioPlayerStatus(player);
  const [current, setCurrent] = useState<string | null>(null);

  const close = () => {
    if (current) player.pause();
    setCurrent(null);
    onClose();
  };

  const toggle = async (id: string) => {
    if (current === id) {
      if (status.playing) player.pause();
      else player.play();
      return;
    }
    const r = await getPlaybackUrl(id);
    if (!r.ok) {
      setError('Could not play that song. Try again.');
      return;
    }
    player.replace({ uri: r.data.url });
    setCurrent(id);
    player.play();
  };

  if (!section) return null;
  const left = Math.max(0, spanSeconds - filledSeconds);

  return (
    <Sheet
      visible
      onClose={close}
      title={`Music for ${sectionTitle(section)}`}
      footer={<Button testID="picker-close" title="Close" variant="ghost" onPress={close} />}
    >
      <Text muted>
        {dur(spanSeconds)} section · {left > 0 ? `${dur(left)} still needs music` : 'already filled'}
      </Text>

      <View style={{ gap: space.sm, padding: space.md, borderRadius: radius.lg, borderWidth: 2, borderColor: colors.accent }}>
        <Text variant="label" style={{ color: colors.accent }}>
          New music
        </Text>
        <Text muted>
          {INTENSITY_WORDS[section.intensity]} intensity · {dur(spanSeconds)}
        </Text>
        <Field testID="picker-style" value={style} onChangeText={setStyle} placeholder="Style, e.g. driving electronic" maxLength={120} />
        <Button testID="picker-generate" title="GENERATE MUSIC FOR THIS SECTION" onPress={() => onGenerate(generateRequest(section, spanSeconds, style))} />
      </View>

      <Text variant="label" muted style={{ marginTop: space.sm }}>
        Your gym&apos;s music
      </Text>
      {error ? <Text style={{ color: colors.danger }}>{error}</Text> : null}
      {loading ? <Text muted>Loading music...</Text> : null}
      {!loading && library.length === 0 ? <Text muted>No gym music yet. Generate some for this section above.</Text> : null}
      {library.map((t) => {
        const playing = current === t.trackId && status.playing;
        return (
          <View key={t.trackId} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.xs, borderTopWidth: 1, borderTopColor: colors.border }}>
            <Pressable
              testID={`picker-play-${t.trackId}`}
              accessibilityRole="button"
              accessibilityLabel={playing ? `Pause ${t.title}` : `Preview ${t.title}`}
              onPress={() => void toggle(t.trackId)}
              style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' }}
            >
              <Text style={{ fontWeight: '800', fontSize: 18 }}>{playing ? '||' : '▶'}</Text>
            </Pressable>
            <View style={{ flex: 1 }}>
              <Text numberOfLines={1} style={{ fontWeight: '600' }}>
                {t.title}
              </Text>
              <Text muted variant="caption" numberOfLines={2}>
                {dur(t.durationSeconds)}
                {t.style ? ` · ${t.style}` : ''}
                {left > 0 ? ` · ${t.durationSeconds >= left ? 'fills the rest' : `${dur(left - t.durationSeconds)} would still be left`}` : ''}
              </Text>
            </View>
            <Pressable
              testID={`picker-choose-${t.trackId}`}
              accessibilityRole="button"
              accessibilityLabel={`Choose ${t.title}`}
              onPress={() => onChoose(t)}
              style={{ minHeight: 52, paddingHorizontal: space.md, borderRadius: radius.md, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' }}
            >
              <Text style={{ fontWeight: '700', color: colors.accentText }}>Choose</Text>
            </Pressable>
          </View>
        );
      })}
    </Sheet>
  );
}
