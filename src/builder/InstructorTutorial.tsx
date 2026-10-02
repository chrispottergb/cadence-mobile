import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, type PropsWithChildren, useContext, useEffect, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, useWindowDimensions, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSession } from '@/auth/session';
import { Button, Card, colors, Screen, space, Text } from '@/ui';

const TutorialContext = createContext({ openTutorial: () => {} });
export const useInstructorTutorial = () => useContext(TutorialContext);
const CARDS = [
  { topic: 'Your class', title: 'Start with what you’re teaching.', body: 'Choose your class length and purpose. We’ll suggest a warm-up, main work and cooldown.', example: '60 minutes · Mixed class', detail: '5 min warm-up · 50 min main work · 5 min cooldown' },
  { topic: 'Timing & cues', title: 'Let Cadence keep the time.', body: 'Add timed rounds, bells or your own spoken reminders. Prefer music only? Leave the cues off.', example: '“Switch partners.”', detail: 'Every 2 minutes during main work' },
  { topic: 'Your music', title: 'Find your class’s sound.', body: 'Choose library tracks or generate new music in your style—with vocals or instrumental. New music uses your gym’s allowance.', example: 'Electronic · Instrumental', detail: 'Use your library or create something new' },
  { topic: 'Ready to teach', title: 'Listen. Save. Teach.', body: 'Preview your music and cues, then save your class. Tap Start class when you’re ready to teach.', example: 'Your class, ready when you are.', detail: 'Saved classes stay on Home for next time' },
];

/** Each instructor sees the introduction once on this device, after signing in. */
export function InstructorTutorialProvider({ children }: PropsWithChildren) {
  const { session } = useSession();
  return <TutorialSession key={session?.user.id ?? 'signed-out'} userId={session?.user.id}>{children}</TutorialSession>;
}

function TutorialSession({ userId, children }: PropsWithChildren<{ userId?: string }>) {
  const router = useRouter();
  const key = `instructor-tutorial:v1:${userId}`;
  const [visible, setVisible] = useState(false);
  const interacted = useRef(false);
  useEffect(() => {
    let live = true;
    if (userId) void AsyncStorage.getItem(key).then(value => {
      if (live && !interacted.current) setVisible(value !== 'seen');
    }).catch(() => { if (live && !interacted.current) setVisible(true); });
    return () => { live = false; };
  }, [key, userId]);
  const close = (create: boolean) => {
    interacted.current = true;
    setVisible(false);
    // A storage failure must not trap an instructor in onboarding.
    if (userId) void AsyncStorage.setItem(key, 'seen').catch(() => undefined);
    if (create) router.push('/soundtracks/new');
  };
  return <TutorialContext.Provider value={{ openTutorial: () => { interacted.current = true; setVisible(true); } }}>
    {children}
    <Modal visible={visible} animationType="slide" onRequestClose={() => close(false)}>
      {visible ? <InstructorTutorial onSkip={() => close(false)} onCreate={() => close(true)} /> : null}
    </Modal>
  </TutorialContext.Provider>;
}

export function InstructorTutorial({ onSkip, onCreate }: { onSkip: () => void; onCreate: () => void }) {
  const { width } = useWindowDimensions();
  const pages = useRef<ScrollView>(null);
  const [page, setPage] = useState(0);
  useEffect(() => { pages.current?.scrollTo({ x: page * width, animated: false }); }, [width, page]);
  const go = (next: number) => setPage(Math.max(0, Math.min(CARDS.length - 1, next)));
  return <Screen padded={false}>
    <View style={{ paddingHorizontal: space.lg, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
      <Text variant="title">cadence<Text style={{ color: colors.accent }}>.</Text></Text>
      <Button title="Skip intro" variant="ghost" onPress={onSkip} />
    </View>
    <Text accessibilityLiveRegion="polite" style={{ paddingHorizontal: space.lg, marginVertical: space.sm }} muted>{page + 1} of 4 · {CARDS[page]!.topic}</Text>
    <ScrollView ref={pages} testID="tutorial-pages" horizontal pagingEnabled showsHorizontalScrollIndicator={false}
      onMomentumScrollEnd={event => go(Math.round(event.nativeEvent.contentOffset.x / width))} style={{ flex: 1 }}>
      {CARDS.map((card, index) => <ScrollView key={card.topic} style={{ width }} contentContainerStyle={{ padding: space.lg, gap: space.lg }}
        accessibilityElementsHidden={page !== index} importantForAccessibility={page === index ? 'auto' : 'no-hide-descendants'}>
        <Card style={{ gap: space.md, paddingVertical: space.xl }}>
          <Text variant="label" muted>For example</Text>
          <Text variant="title" style={{ color: colors.accent }}>{card.example}</Text>
          <Text>{card.detail}</Text>
        </Card>
        <Text accessibilityRole="header" variant="display">{card.title}</Text>
        <Text>{card.body}</Text>
      </ScrollView>)}
    </ScrollView>
    <View style={{ paddingHorizontal: space.lg, gap: space.sm }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Button title="Back" disabled={page === 0} variant="ghost" onPress={() => go(page - 1)} />
        <View style={{ flexDirection: 'row' }}>{CARDS.map((card, index) => <Pressable key={card.topic} accessibilityRole="button"
          accessibilityLabel={`Tutorial card ${index + 1}: ${card.topic}`} accessibilityState={{ selected: page === index }} onPress={() => go(index)}
          style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ width: page === index ? 22 : 8, height: 8, borderRadius: 4, backgroundColor: page === index ? colors.accent : colors.textMuted }} />
        </Pressable>)}</View>
      </View>
      <Button testID="tutorial-next" title={page === 3 ? 'Create my class' : 'Next'} onPress={() => page === 3 ? onCreate() : go(page + 1)} />
      <Text muted variant="caption" style={{ textAlign: 'center' }}>Swipe to explore · Replay anytime from Home</Text>
    </View>
  </Screen>;
}
