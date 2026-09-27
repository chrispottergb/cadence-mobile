import { useRouter } from 'expo-router';
import { View } from 'react-native';

import { Button, Placeholder, space } from '@/ui';

export default function Screen() {
  const router = useRouter();
  return (
    <Placeholder title="Create" note="The full creation tools arrive in a later phase. A development generator is available to exercise the music pipeline.">
      <View style={{ height: space.lg }} />
      <Button testID="open-generator" title="Open generator (development)" variant="secondary" onPress={() => router.push('/generator')} />
    </Placeholder>
  );
}
