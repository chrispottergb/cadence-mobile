import { useRouter } from 'expo-router';
import { View } from 'react-native';

import { signOut } from '@/auth/session';
import { availableExperiences, type Experience } from '@/experience/resolve';
import { selectExperience, useExperience } from '@/experience/store';
import { Button, Screen, space, Text } from '@/ui';

const LABEL: Record<Experience, string> = { instructor: 'Instructor', student: 'Student', parent: 'Parent' };

/** Modal switcher. Only experiences the database allows are listed. */
export default function Switch() {
  const router = useRouter();
  const { flags, selected } = useExperience();
  const options = availableExperiences(flags);

  const choose = async (e: Experience) => {
    if (await selectExperience(e)) router.replace(`/(${e})` as never);
  };

  return (
    <Screen>
      <Text variant="display">Switch experience</Text>
      <Text muted style={{ marginTop: space.sm, marginBottom: space.lg }}>
        You stay signed in.
      </Text>
      {options.map((e) => (
        <View key={e} style={{ marginBottom: space.sm }}>
          <Button testID={`switch-${e}`} title={e === selected ? `${LABEL[e]} (current)` : LABEL[e]} variant={e === selected ? 'secondary' : 'primary'} onPress={() => choose(e)} />
        </View>
      ))}
      <View style={{ flex: 1 }} />
      <Button title="Sign out" variant="ghost" onPress={() => void signOut()} />
      <Button title="Close" variant="ghost" onPress={() => router.back()} />
    </Screen>
  );
}
