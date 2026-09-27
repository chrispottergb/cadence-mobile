import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';

import { signOut, useSession } from '@/auth/session';
import { acceptInvite, createGym, listMyInvites } from '@/data/gyms';
import { loadExperiences } from '@/experience/store';
import { Button, Card, Field, Screen, space, Text } from '@/ui';

/**
 * A signed-in person with no gym and no guardian link lands here instead of
 * on a crash or a blank tab bar. Two ways forward in Phase 1: create a gym
 * (become its owner) or accept a pending invite. Guardian onboarding waits
 * for the privacy review.
 */
export default function Onboarding() {
  const { session } = useSession();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invites, setInvites] = useState<{ id: string; gym_id: string; role: string }[]>([]);

  useEffect(() => {
    void listMyInvites().then((r) => setInvites(r.invites));
  }, []);

  const create = async () => {
    if (!session) return;
    setBusy(true);
    setError(null);
    const { error: err } = await createGym(name, session.user.id);
    if (err) {
      setError(err);
      setBusy(false);
      return;
    }
    await loadExperiences();
    setBusy(false);
  };

  const accept = async (id: string) => {
    setBusy(true);
    const err = await acceptInvite(id);
    if (err) setError(err);
    else await loadExperiences();
    setBusy(false);
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ gap: space.md }}>
        <Text variant="label" muted>
          Cadence
        </Text>
        <Text variant="display">Welcome</Text>
        <Text muted>You are not part of a gym yet.</Text>

        <Card>
          <Text variant="title">Start a gym</Text>
          <Text muted style={{ marginTop: space.xs, marginBottom: space.md }}>
            You become its owner. Instructors and students can be invited afterwards.
          </Text>
          <Field testID="gym-name" value={name} onChangeText={setName} placeholder="Gym name" />
          <View style={{ height: space.sm }} />
          <Button testID="create-gym" title="Create gym" onPress={create} loading={busy} disabled={name.trim().length < 2} />
        </Card>

        {invites.length > 0 ? (
          <Card>
            <Text variant="title">Invitations</Text>
            {invites.map((i) => (
              <View key={i.id} style={{ marginTop: space.sm }}>
                <Button title={`Join as ${i.role}`} variant="secondary" onPress={() => accept(i.id)} loading={busy} />
              </View>
            ))}
          </Card>
        ) : null}

        <Card>
          <Text variant="title">Parents and students</Text>
          <Text muted style={{ marginTop: space.xs }}>
            Students join through a gym invitation. Parent accounts are linked to a student by the student or the gym. Those flows arrive
            in a later release.
          </Text>
        </Card>

        {error ? (
          <Text variant="caption" style={{ color: '#E5484D' }}>
            {error}
          </Text>
        ) : null}
        <Button title="Sign out" variant="ghost" onPress={() => void signOut()} />
      </ScrollView>
    </Screen>
  );
}
