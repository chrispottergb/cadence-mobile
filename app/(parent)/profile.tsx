import { useRouter } from 'expo-router';
import { View } from 'react-native';

import { signOut, useSession } from '@/auth/session';
import { Button, Screen, space, Text } from '@/ui';

export default function Profile() {
  const { session } = useSession();
  const router = useRouter();
  return (
    <Screen>
      <Text variant="display">Profile</Text>
      <Text muted style={{ marginTop: space.sm }}>
        {session?.user.email ?? ''}
      </Text>
      <View style={{ flex: 1 }} />
      <Button title="Switch experience" variant="secondary" onPress={() => router.push('/switch')} />
      <View style={{ height: space.sm }} />
      <Button title="Sign out" variant="ghost" onPress={() => void signOut()} />
    </Screen>
  );
}
