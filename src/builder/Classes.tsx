import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';

import { listMyGyms } from '@/data/gyms';
import { listSoundtracks, type SoundtrackRow } from '@/data/soundtracks';
import { dur } from '@/soundtrack/guided';
import { Button, Card, colors, Screen, space, Text } from '@/ui';
import { useInstructorTutorial } from './InstructorTutorial';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSession } from '@/auth/session';

/** The gym's classes (class soundtracks are gym assets). */
export function Classes({ home = false }: { home?: boolean }) {
  const router = useRouter();
  const { openTutorial } = useInstructorTutorial();
  const { session } = useSession();
  const userId = session?.user.id;
  const [hasDraft, setHasDraft] = useState(false);
  const [gymId, setGymId] = useState<string | null>(null);
  const [rows, setRows] = useState<SoundtrackRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);

  const load = useCallback(async () => {
    const current = ++request.current;
    setLoading(true);
    setError(null);
    try {
      const g = await listMyGyms();
      if (current !== request.current) return;
      if (g.error) throw new Error(g.error);
      const id = g.gyms[0]?.id ?? null;
      setGymId(id);
      const stored = home && id && userId ? await AsyncStorage.getItem(`instructor-class:v1:${userId}:${id}`).catch(() => null) : null;
      if (current !== request.current) return;
      setHasDraft(!!stored);
      if (id) {
        const r = await listSoundtracks(id);
        if (current !== request.current) return;
        if (r.error) throw new Error(r.error);
        setRows(r.rows);
      } else setRows([]);
    } catch {
      if (current === request.current) setError('Could not load your classes. Check your connection and try again.');
    } finally {
      if (current === request.current) setLoading(false);
    }
  }, [home, userId]);

  useFocusEffect(
    useCallback(() => {
      void load();
      return () => { request.current++; };
    }, [load]),
  );

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ gap: space.md, paddingBottom: space.xxl }} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.accent} />}>
        <Text variant="display">{home ? 'Ready to teach?' : 'Classes'}</Text>
        <Text muted>Choose your class length, purpose, music and cues. Preview your soundtrack, then start teaching.</Text>
        <Button testID="st-new" title={hasDraft ? 'Continue creating your class' : 'Create class soundtrack'} onPress={() => router.push('/soundtracks/new')} disabled={!gymId} />
        {hasDraft ? <Text muted>Your draft is saved. Pick up where you left off.</Text> : null}
        {!loading && !gymId && !error ? <Text muted>Create or join a gym as staff to build classes.</Text> : null}
        {home ? <Button title="Open music library" variant="secondary" onPress={() => router.push('/(instructor)/library')} /> : null}
        {home ? <Button testID="home-tutorial" title="How to create a class · Tutorial" variant="ghost" onPress={openTutorial} /> : null}
        <Text variant="title">Your saved classes</Text>
        {loading && !rows.length ? <Text muted>Loading your classes…</Text> : null}
        {!loading && !error && gymId && !rows.length ? <Card style={{ gap: space.sm }}><Text variant="title">Your first class starts here</Text><Text muted>Create a class soundtrack above. Once saved, it will appear here ready to edit or teach again.</Text></Card> : null}

        {error ? <><Text style={{ color: colors.danger }}>{error}</Text><Button title="Try again" variant="secondary" onPress={() => void load()} /></> : null}
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
        {!home ? <Button title="Back" variant="ghost" onPress={() => router.back()} /> : null}
      </ScrollView>
    </Screen>
  );
}
