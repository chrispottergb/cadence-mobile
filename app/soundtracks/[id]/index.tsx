import { useLocalSearchParams } from 'expo-router';

import { GuidedBuilder } from '@/builder/GuidedBuilder';

/** An existing class in the Guided Builder (opens on its overview). */
export default function GuidedClass() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <GuidedBuilder key={id} id={id} />;
}
