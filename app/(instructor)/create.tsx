import { useRouter } from 'expo-router';
import { ScrollView } from 'react-native';

import { Button, Card, Screen as Page, space, Text } from '@/ui';

export default function Screen() {
  const router = useRouter();
  return (
    <Page>
      <ScrollView contentContainerStyle={{ gap: space.md, paddingBottom: space.xxl }}>
        <Text variant="display">Create</Text>
        <Card style={{ gap: space.md }}>
          <Text variant="title">Build your next class</Text>
          <Text muted>Choose the length and purpose, set your timing and cues, then choose the music. We’ll put your class soundtrack together.</Text>
          <Button testID="create-class" title="Create class soundtrack" onPress={() => router.push('/soundtracks/new')} />
        </Card>
        <Button title="Open saved classes" variant="secondary" onPress={() => router.push('/soundtracks')} />
        <Button testID="open-generator" title="Create a single music track" variant="ghost" onPress={() => router.push('/generator')} />
      </ScrollView>
    </Page>
  );
}
