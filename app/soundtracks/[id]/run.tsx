import { useLocalSearchParams } from 'expo-router';

import { RunningClass } from '@/builder/RunningClass';

export default function RunClass() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <RunningClass key={id} id={id} />;
}
