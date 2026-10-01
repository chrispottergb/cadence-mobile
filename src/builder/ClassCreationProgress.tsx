import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import type { ClassGeneration } from '@/music/classGeneration';
import { dur, layoutMusic, MIN_PIECE_SECONDS, sectionTitle } from '@/soundtrack/guided';
import { Card, colors, radius, space, Text } from '@/ui';

/** Coverage is measured from assembled music. The service reports stages,
 * not a render percentage or a reliable finish time. */
export function ClassCreationProgress({ generation, busy, pausing, minutes, source }: {
  generation?: ClassGeneration;
  busy: boolean;
  pausing: boolean;
  minutes: number;
  source: 'library' | 'generate';
}) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [busy]);

  const sections = generation?.plan.sections.map(section => ({
    id: section.id,
    title: sectionTitle(section),
    seconds: section.minutes * 60,
    layout: layoutMusic(section, section.minutes * 60),
  })) ?? [];
  const total = (generation?.plan.minutes ?? minutes) * 60;
  const filled = sections.reduce((sum, s) => sum + s.layout.filledSeconds, 0);
  const percent = total > 0 ? Math.max(0, Math.min(100, Math.floor(filled / total * 100))) : 0;
  const pending = generation?.pending;
  const started = pending?.startedAt ? Date.parse(pending.startedAt) : NaN;
  const elapsed = Number.isFinite(started) ? Math.max(0, Math.floor((now - started) / 1000)) : null;
  const current = sections.find(s => s.id === pending?.sectionId);
  let stage = source === 'library' ? 'Assembling your class' : 'Preparing your music';
  if (pending) {
    if (!pending.jobId) stage = 'Requesting music';
    else if (pending.state === 'QUEUED') stage = 'Waiting for music to start';
    else if (pending.state === 'READY' || pending.state === 'PARTIAL') stage = 'Adding music to your class';
    else if (pending.processing) stage = 'Saving your new tracks';
    else if (pending.state === 'RENDERING' || pending.state === 'SUBMITTED') stage = 'Generating music';
    else stage = 'Checking music status';
  } else if (generation) stage = 'Assembling your class';
  if (generation?.failure) stage = 'Music generation needs attention';
  else if (pausing && busy) stage = 'Pausing after the current request';
  else if (!busy) stage = 'Creation paused';

  return (
    <Card testID="class-creation-progress" style={{ gap: space.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        {busy ? <ActivityIndicator testID="class-creation-spinner" color={colors.accent} /> : null}
        <Text variant="title" accessibilityLiveRegion="polite" style={{ flex: 1 }}>{stage}</Text>
      </View>
      {current ? <Text>{current.title} · Music request {generation!.requests}</Text> : null}
      {busy && elapsed !== null ? <Text muted>Current request: {dur(elapsed)} elapsed</Text> : null}
      <Text>{percent}% of class music ready · {dur(filled)} of {dur(total)}</Text>
      <View testID="class-coverage" accessibilityRole="progressbar" accessibilityLabel="Class music ready"
        accessibilityValue={{ min: 0, max: 100, now: percent, text: `${percent}% of class music ready` }}
        style={{ height: 10, borderRadius: radius.sm, backgroundColor: colors.border, overflow: 'hidden' }}>
        <View style={{ height: '100%', width: `${percent}%`, backgroundColor: colors.accent }} />
      </View>
      {sections.map(s => (
        <View key={s.id} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.sm }}>
          <Text style={{ flex: 1 }}>{s.title}</Text>
          <Text muted>{s.layout.quietSeconds < MIN_PIECE_SECONDS ? 'Ready' : s.id === pending?.sectionId && busy ? 'In progress' : s.layout.filledSeconds > 0 ? `${dur(s.layout.filledSeconds)} ready` : 'Waiting'}</Text>
        </View>
      ))}
      {source === 'generate' ? <Text muted>{generation?.tracks.length ?? 0} {generation?.tracks.length === 1 ? 'track' : 'tracks'} ready{generation?.plan.instructor?.repeatMusic ? ' · Repeats included in class coverage' : ''}</Text> : null}
      <Text muted>{busy
        ? source === 'library' ? 'Putting your selected music and cues together. Preview opens when your class is ready.' : 'Generation can take several minutes. This bar measures music already added to your class. Preview opens when the class is assembled.'
        : 'Your progress is kept. Resume below, or open Preview with the music that is ready.'}</Text>
    </Card>
  );
}
