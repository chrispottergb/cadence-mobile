import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { startSession, useSession } from '@/auth/session';
import { clearExperience, loadExperiences, useExperience } from '@/experience/store';
import { colors, Loading } from '@/ui';

/**
 * Root gate. Three states drive routing:
 *   no session            -> (auth)
 *   session, no experience -> onboarding
 *   session + experience   -> that experience's tab shell
 * Experience flags come from the database each time a session appears.
 */
export default function RootLayout() {
  const session = useSession();
  const experience = useExperience();
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    startSession();
  }, []);

  const userId = session.session?.user.id ?? null;
  useEffect(() => {
    if (!session.ready) return;
    if (userId) void loadExperiences();
    else void clearExperience();
  }, [session.ready, userId]);

  useEffect(() => {
    if (!session.ready) return;
    const top = segments[0] as string | undefined;
    if (!session.session) {
      if (top !== '(auth)') router.replace('/(auth)/sign-in');
      return;
    }
    if (!experience.loaded) return;
    const target = experience.selected ? `/(${experience.selected})` : '/onboarding';
    const inTarget = experience.selected ? top === `(${experience.selected})` : top === 'onboarding';
    if (!inTarget && top !== 'switch' && top !== 'generator' && top !== 'audio-lab') router.replace(target as never);
  }, [session.ready, session.session, experience.loaded, experience.selected, segments, router]);

  const booting = !session.ready || (session.session && !experience.loaded);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bg }}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        {booting ? (
          <Loading />
        ) : (
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
            <Stack.Screen name="(auth)" />
            <Stack.Screen name="onboarding" />
            <Stack.Screen name="(instructor)" />
            <Stack.Screen name="(student)" />
            <Stack.Screen name="(parent)" />
            <Stack.Screen name="switch" options={{ presentation: 'modal' }} />
            <Stack.Screen name="generator" />
            <Stack.Screen name="audio-lab" />
          </Stack>
        )}
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
