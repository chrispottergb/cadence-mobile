import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';

import { useSession } from '@/auth/session';
import { type Gym, inviteMember, listMyGyms } from '@/data/gyms';
import { fetchCapabilities } from '@/music/client';
import { Button, Card, Field, Screen, space, Text } from '@/ui';

/**
 * Gym tab, Phase 1: the gyms this person belongs to, an instructor invite
 * form (RLS decides whether it is allowed), and a read-only capabilities
 * probe against the Music Service to prove the app-to-service path.
 */
export default function GymTab() {
  const { session } = useSession();
  const [gyms, setGyms] = useState<Gym[]>([]);
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [caps, setCaps] = useState<string>('not checked');

  useEffect(() => {
    void listMyGyms().then((r) => setGyms(r.gyms));
  }, []);

  const invite = async (gymId: string) => {
    if (!session) return;
    const err = await inviteMember(gymId, email, 'instructor', session.user.id);
    setMsg(err ? `Could not invite: ${err}` : 'Invitation created.');
    if (!err) setEmail('');
  };

  const probe = async () => {
    const { caps: c, error } = await fetchCapabilities();
    setCaps(error ?? `service ok, ${c?.candidatesPerJob} candidates per generation`);
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ gap: space.md }}>
        <Text variant="display">Gym</Text>
        {gyms.map((g) => (
          <Card key={g.id}>
            <Text variant="title">{g.name}</Text>
            <Text variant="caption" muted>
              {g.slug}
            </Text>
            <View style={{ height: space.md }} />
            <Field testID="invite-email" value={email} onChangeText={setEmail} placeholder="Invite instructor by email" autoCapitalize="none" keyboardType="email-address" />
            <View style={{ height: space.sm }} />
            <Button title="Send invitation" variant="secondary" onPress={() => invite(g.id)} disabled={!email.includes('@')} />
          </Card>
        ))}
        {gyms.length === 0 ? <Text muted>No gyms yet.</Text> : null}
        {msg ? <Text variant="caption">{msg}</Text> : null}
        <Card>
          <Text variant="title">Music service</Text>
          <Text variant="caption" muted style={{ marginVertical: space.sm }}>
            {caps}
          </Text>
          <Button title="Check connection" variant="secondary" onPress={probe} />
        </Card>
      </ScrollView>
    </Screen>
  );
}
