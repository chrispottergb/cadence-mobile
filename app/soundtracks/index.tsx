import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { listMyGyms } from '@/data/gyms';
import { listSoundtracks, type SoundtrackRow } from '@/data/soundtracks';
import { dur } from '@/soundtrack/guided';
import { Button, Card, colors, Screen, space, Text } from '@/ui';

/** The gym's classes (class soundtracks are gym assets). */
export default function Classes() {
  const router = useRouter();
  const [gymId, setGymId] = useState<string | null>(null);
  const [rows, setRows] = useState<SoundtrackRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const g = await listMyGyms();
    const id = g.gyms[0]?.id ?? null;
    setGymId(id);
    if (id) {
      const r = await listSoundtracks(id);
      setRows(r.rows);
      setError(r.error);
    }
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ gap: space.md, paddingBottom: space.xxl }}>
        <Text variant="display">Classes</Text>
        <Text muted>Describe your class. Cadence builds the music and cues around it.</Text>
        {!loading && !gymId ? <Text muted>Create or join a gym as staff to build classes.</Text> : null}
        <Button testID="st-new" title="+ Build a new class" onPress={() => router.push('/soundtracks/new')} disabled={!gymId} />

        {error ? <Text style={{ color: colors.danger }}>{error}</Text> : null}
        {rows.map((r) => (
          <Card key={r.id} style={{ gap: space.sm }}>
            <Pressable testID={`st-${r.id}`} accessibilityRole="button" onPress={() => router.push({ pathname: '/soundtracks/[id]', params: { id: r.id } })} style={{ gap: space.xs }}>
              <Text variant="title">{r.name}</Text>
              <Text muted>
                {dur(r.durationSeconds)} · saved {new Date(r.updatedAt).toLocaleDateString()}
              </Text>
            </Pressable>
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              <View style={{ flex: 1 }}>
                <Button testID={`st-edit-${r.id}`} title="Edit" variant="secondary" onPress={() => router.push({ pathname: '/soundtracks/[id]', params: { id: r.id } })} />
              </View>
              <View style={{ flex: 1 }}>
                <Button testID={`st-run-${r.id}`} title="Start class" onPress={() => router.push({ pathname: '/soundtracks/[id]/run', params: { id: r.id } })} />
              </View>
            </View>
          </Card>
        ))}
        <Button title="Back" variant="ghost" onPress={() => router.back()} />
      </ScrollView>
    </Screen>
  );
}
