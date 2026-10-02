import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import type { PlayableTrack } from '@/audiolab/assets';
import { getPlaybackUrl } from '@/music/client';
import { dur } from '@/soundtrack/guided';
import { Button, colors, space, Text } from '@/ui';

/** One player for the list. Expo releases it when this step closes. */
export function LibraryMusicChoices({ tracks, selected, onChoose }: { tracks: PlayableTrack[]; selected: string[]; onChoose: (id: string) => void }) {
  const player = useAudioPlayer(null);
  const status = useAudioPlayerStatus(player);
  const [current, setCurrent] = useState<string | null>(null);
  const [error, setError] = useState('');
  const request = useRef(0);
  useEffect(() => () => { request.current++; }, []);
  const listen = async (id: string) => {
    const token = ++request.current;
    setError('');
    if (current === id) { if (status.playing) player.pause(); else player.play(); return; }
    player.pause();
    try {
      const result = await getPlaybackUrl(id);
      if (token !== request.current) return;
      if (!result.ok) { setError('Could not preview that track. Try again.'); return; }
      player.replace({ uri: result.data.url }); setCurrent(id); player.play();
    } catch { if (token === request.current) setError('Could not preview that track. Try again.'); }
  };
  return <View style={{ gap: space.sm }}>
    {tracks.map(track => {
      const order = selected.indexOf(track.trackId) + 1;
      return <View key={track.trackId} style={{ gap: space.xs, paddingBottom: space.sm, borderBottomWidth: 1, borderBottomColor: colors.border }}>
        <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: order > 0 }} onPress={() => onChoose(track.trackId)}
          style={{ minHeight: 52, justifyContent: 'center', padding: space.sm, borderRadius: 12, backgroundColor: order ? colors.accent : colors.surfaceRaised }}>
          <Text style={{ color: order ? colors.accentText : colors.text }}>{order ? `${order}. ` : ''}{track.title} · {dur(track.durationSeconds)}</Text>
        </Pressable>
        <Button title={current === track.trackId && status.playing ? `Pause ${track.title}` : `Listen to ${track.title}`} variant="ghost" onPress={() => void listen(track.trackId)} />
      </View>;
    })}
    {error ? <Text accessibilityLiveRegion="polite">{error}</Text> : null}
  </View>;
}
