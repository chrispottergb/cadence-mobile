import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { useSession } from '@/auth/session';
import { listMyGyms } from '@/data/gyms';
import { createSoundtrack, listSoundtracks, type SoundtrackRow } from '@/data/soundtracks';
import { formatClock } from '@/audiolab/timeline';
import { newSoundtrack } from '@/soundtrack/model';
import { Button, Card, colors, Field, Screen, space, Text } from '@/ui';

/** Class Soundtracks for the instructor's gym (gym assets). */
export default function Soundtracks() {
  const router = useRouter();
  const session = useSession();
  const [gymId, setGymId] = useState<string | null>(null);
  const [rows, setRows] = useState<SoundtrackRow[]>([]);
  const [name, setName] = useState('');
  const [minutes, setMinutes] = useState(45);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const g = await listMyGyms();
    const id = g.gyms[0]?.id ?? null;
    setGymId(id);
    if (!id) return;
    const r = await listSoundtracks(id);
    setRows(r.rows);
    setError(r.error);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const create = async () => {
    const uid = session.session?.user.id;
    if (!gymId || !uid) return;
    setBusy(true);
    const s = newSoundtrack(name || 'New class', minutes * 60);
    const r = await createSoundtrack(gymId, uid, s);
    setBusy(false);
    if (r.error || !r.id) setError(r.error ?? 'Could not create the soundtrack.');
    else router.push({ pathname: '/soundtracks/[id]', params: { id: r.id } });
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ gap: space.md, paddingBottom: space.xxl }}>
        <Text variant="display">Class soundtracks</Text>
        <Text muted>Build the soundtrack around the class: music, cues and sections on one timeline.</Text>
        {!gymId ? <Text muted>Create or join a gym as staff to build class soundtracks.</Text> : null}

        <Card style={{ gap: space.sm }}>
          <Text variant="label" muted>
            New class
          </Text>
          <Field testID="st-name" value={name} onChangeText={setName} placeholder="e.g. Tuesday kickboxing" maxLength={80} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <View style={{ flex: 1 }}>
              <Button title="-5 min" variant="secondary" onPress={() => setMinutes((m) => Math.max(5, m - 5))} />
            </View>
            <Text variant="title" style={{ minWidth: 90, textAlign: 'center' }}>
              {minutes} min
            </Text>
            <View style={{ flex: 1 }}>
              <Button title="+5 min" variant="secondary" onPress={() => setMinutes((m) => Math.min(240, m + 5))} />
            </View>
          </View>
          <Button testID="st-create" title="Create and open" onPress={create} loading={busy} disabled={!gymId} />
        </Card>

        {error ? <Text style={{ color: colors.danger }}>{error}</Text> : null}
        {rows.map((r) => (
          <Pressable key={r.id} testID={`st-${r.id}`} onPress={() => router.push({ pathname: '/soundtracks/[id]', params: { id: r.id } })}>
            <Card style={{ gap: space.xs }}>
              <Text variant="title">{r.name}</Text>
              <Text muted>
                {formatClock(r.durationSeconds).replace(/\.\d$/, '')} · saved {new Date(r.updatedAt).toLocaleString()}
              </Text>
            </Card>
          </Pressable>
        ))}
        <Button title="Back" variant="ghost" onPress={() => router.back()} />
      </ScrollView>
    </Screen>
  );
}
