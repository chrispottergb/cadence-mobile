import { Tabs, useRouter } from 'expo-router';
import { Pressable, Text as RNText } from 'react-native';

import { useExperience } from '@/experience/store';

import { colors, space, type } from './tokens';

/**
 * Shared tab-shell chrome for the three experiences. A header button opens
 * the experience switcher; it is shown only when more than one experience is
 * available.
 */
export function ExperienceTabs({ tabs, title }: { title: string; tabs: { name: string; label: string }[] }) {
  const router = useRouter();
  const { flags } = useExperience();
  const multi = [flags.instructor, flags.student, flags.parent].filter(Boolean).length > 1;

  return (
    <Tabs
      screenOptions={{
        headerShown: true,
        headerTitle: title,
        headerStyle: { backgroundColor: colors.bg },
        headerTitleStyle: { color: colors.text, ...type.title },
        headerShadowVisible: false,
        headerRight: () =>
          multi ? (
            <Pressable testID="open-switcher" accessibilityRole="button" onPress={() => router.push('/switch')} style={{ paddingHorizontal: space.md }}>
              <RNText style={{ color: colors.accent, ...type.label }}>Switch</RNText>
            </Pressable>
          ) : null,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border, height: 84, paddingTop: space.sm },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarLabelStyle: { ...type.caption, fontWeight: '600' },
        tabBarIconStyle: { display: 'none' },
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      {tabs.map((t) => (
        <Tabs.Screen key={t.name} name={t.name} options={{ title: t.label }} />
      ))}
    </Tabs>
  );
}
