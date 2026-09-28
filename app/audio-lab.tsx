import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Platform, ScrollView, Share, View } from 'react-native';
import * as Application from 'expo-application';
import * as Device from 'expo-device';

import { clearLabCache, cueSeconds, listPlayable, loadCueAssets, type PlayableTrack, resolveTrack } from '@/audiolab/assets';
import type { EngineSnapshot, LabEngine } from '@/audiolab/engine';
import { GraphEngine } from '@/audiolab/graphEngine';
import { clearLab, exportRun, getTest, jsHeapBytes, labEvents, record, setTest, subscribeLab, summarize } from '@/audiolab/metrics';
import { PlayerEngine } from '@/audiolab/playerEngine';
import { type CueSpec, expandCues, formatClock, placeTracks, resolveCollisions, type TimelineTrack, totalDuration } from '@/audiolab/timeline';
import { Button, Card, colors, Screen, space, Text } from '@/ui';

/**
 * AUDIO LAB: Phase 3 Stage A engineering harness. Development builds only
 * (EXPO_PUBLIC_AUDIO_LAB=1). Not a product screen.
 */
export const AUDIO_LAB_ENABLED = process.env.EXPO_PUBLIC_AUDIO_LAB === '1';

type EngineName = 'graph' | 'player';
type Scenario = 'class3' | 'long30' | 'long45';

function buildScenario(s: Scenario, tracks: PlayableTrack[], crossfade: number) {
  const pick = (i: number) => tracks[i % tracks.length]!;
  let seq: PlayableTrack[];
  if (s === 'class3') seq = [pick(0), pick(1), pick(2)];
  else {
    const target = s === 'long30' ? 30 * 60 : 45 * 60;
    seq = [];
    let total = 0;
    for (let i = 0; total < target; i++) {
      seq.push(pick(i));
      total += pick(i).durationSeconds - (i ? crossfade : 0);
    }
  }
  const timeline: TimelineTrack[] = seq.map((t, i) => ({ trackId: t.trackId, sourceDurationSeconds: t.durationSeconds, crossfadeInSeconds: i ? crossfade : 0 }));
  const placed = placeTracks(timeline);
  const total = totalDuration(placed);
  const cue = (id: string, time: number, asset: Parameters<typeof cueSeconds>[0], priority: CueSpec['priority'], extra: Partial<CueSpec> = {}): CueSpec => ({
    id,
    timeSeconds: time,
    assetId: asset,
    assetDurationSeconds: cueSeconds(asset),
    priority,
    duckTo: 0.3,
    ...extra,
  });
  const specs: CueSpec[] =
    s === 'class3'
      ? [
          cue('start-bell', 2, 'bell', 'high'),
          cue('round', 4, 'round', 'high'),
          cue('switch', 15, 'switch', 'normal', { repeatEverySeconds: 15, repeatUntilSeconds: total - 5 }),
          // Deliberate collision: a low cue on top of a high one at 60 s.
          cue('bell-60', 60, 'bell', 'high'),
          cue('cheer-60', 60.3, 'switch', 'low'),
          cue('thirty', Math.max(5, total - 30), 'thirty', 'normal'),
          cue('stop', Math.max(6, total - 3), 'stop', 'high'),
        ]
      : [
          cue('round-bell', 0.5, 'bell', 'high', { repeatEverySeconds: 180, repeatUntilSeconds: total - 5 }),
          cue('switch', 90, 'switch', 'normal', { repeatEverySeconds: 180, repeatUntilSeconds: total - 5 }),
          cue('thirty', 150, 'thirty', 'normal', { repeatEverySeconds: 180, repeatUntilSeconds: total - 5 }),
          cue('stop', Math.max(6, total - 3), 'stop', 'high'),
        ];
  const resolved = resolveCollisions(expandCues(specs, total));
  return { placed, total, cues: resolved.play, dropped: resolved.dropped.length, deferred: resolved.deferred.length, seq };
}

export default function AudioLab() {
  const router = useRouter();
  const [engineName, setEngineName] = useState<EngineName>('graph');
  const [mode, setMode] = useState<'download' | 'stream'>('download');
  const [crossfade, setCrossfade] = useState(0);
  const [shortLinks, setShortLinks] = useState(false);
  const [test, setTestState] = useState(getTest());
  const [tracks, setTracks] = useState<PlayableTrack[]>([]);
  const [info, setInfo] = useState<string>('');
  const [snap, setSnap] = useState<EngineSnapshot | null>(null);
  const engine = useRef<LabEngine | null>(null);
  const [totalSeconds, setTotalSeconds] = useState(0);
  const events = useSyncExternalStore(subscribeLab, labEvents, labEvents);

  useEffect(() => {
    void listPlayable().then((t) => {
      setTracks(t);
      record('lab', 'playable', { count: t.length });
    });
    const i = setInterval(() => engine.current && setSnap(engine.current.snapshot()), 250);
    // Heartbeat for drift and memory over long sessions: engine position vs wall clock.
    let playStart: { wall: number; pos: number } | null = null;
    const hb = setInterval(() => {
      const e = engine.current;
      if (!e) return;
      const sn = e.snapshot();
      if (sn.state !== 'PLAYING') {
        playStart = null;
        return;
      }
      playStart ??= { wall: Date.now(), pos: sn.positionSeconds };
      const wall = (Date.now() - playStart.wall) / 1000;
      record('lab', 'heartbeat', {
        engine: e.name,
        position: Number(sn.positionSeconds.toFixed(3)),
        wallElapsed: Number(wall.toFixed(3)),
        driftMs: Math.round((sn.positionSeconds - playStart.pos - wall) * 1000),
        heapBytes: jsHeapBytes(),
        route: sn.route,
      });
    }, 30_000);
    return () => {
      clearInterval(i);
      clearInterval(hb);
      void engine.current?.dispose();
    };
  }, []);

  const load = useCallback(
    async (s: Scenario) => {
      if (tracks.length < 2) {
        setInfo('Need at least two playable tracks for this account.');
        return;
      }
      await engine.current?.dispose();
      const e = engineName === 'graph' ? new GraphEngine(() => undefined) : new PlayerEngine(() => undefined);
      engine.current = e;
      const sc = buildScenario(s, tracks, crossfade);
      setTotalSeconds(sc.total);
      const unique = [...new Map(sc.seq.map((t) => [t.trackId, t])).values()];
      setInfo(`Loading ${unique.length} tracks (${mode})...`);
      const loaded = [];
      for (const t of unique) loaded.push(await resolveTrack(t, mode, shortLinks ? 90 : undefined));
      const assets = await loadCueAssets();
      await e.load(sc.placed, loaded, sc.cues, assets);
      record('lab', 'scenario', { scenario: s, engine: e.name, mode, crossfade, shortLinks, demo: sc.seq.every((t) => t.demo !== undefined), totalSeconds: Number(sc.total.toFixed(2)), segments: sc.placed.length, cues: sc.cues.length, dropped: sc.dropped, deferred: sc.deferred });
      setInfo(`${s}: ${sc.placed.length} segments, ${formatClock(sc.total)}, ${sc.cues.length} cues (${sc.dropped} dropped, ${sc.deferred} deferred by policy)`);
      setSnap(e.snapshot());
    },
    [tracks, engineName, mode, crossfade, shortLinks],
  );

  const late = events.filter((e) => e.kind === 'cue_fired').map((e) => Number(e.data.lateMs));
  const stats = summarize(late);
  const sp = snap;
  const act = useCallback((action: 'play' | 'pause' | 'resume' | 'stop' | 'seek', delta = 0) => {
    const e = engine.current;
    if (!e) return;
    if (action === 'play') void e.play(0);
    else if (action === 'pause') void e.pause();
    else if (action === 'resume') void e.resume();
    else if (action === 'stop') void e.stop();
    else void e.seek(e.snapshot().positionSeconds + delta);
  }, []);

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ gap: space.md, paddingBottom: space.xxl }}>
        <Text variant="label" muted>
          Development only
        </Text>
        <Text variant="display">Audio Lab</Text>
        {!AUDIO_LAB_ENABLED ? <Text muted>Not available in this build.</Text> : null}

        <Card style={{ gap: space.sm }}>
          <Text variant="label" muted>
            Which test are you running? (tags every measurement)
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            {['T1 Basic', 'T2 Bluetooth', 'T3 Interrupt', 'T4 Cues', 'T5 Ducking', 'T6 Transitions', 'T7 30 min', 'T8 45 min', 'Links', 'Network'].map((l) => (
              <Button
                key={l}
                title={test === l ? `● ${l}` : l}
                variant={test === l ? 'primary' : 'secondary'}
                onPress={() => {
                  setTest(l);
                  setTestState(l);
                }}
              />
            ))}
          </View>
        </Card>

        <Card style={{ gap: space.sm }}>
          <Text variant="label" muted>
            Setup ({tracks.length} authorized tracks)
          </Text>
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <View style={{ flex: 1 }}>
              <Button testID="lab-engine" title={`Engine: ${engineName}`} variant="secondary" onPress={() => setEngineName(engineName === 'graph' ? 'player' : 'graph')} />
            </View>
            <View style={{ flex: 1 }}>
              <Button testID="lab-mode" title={`Source: ${mode}`} variant="secondary" onPress={() => setMode(mode === 'download' ? 'stream' : 'download')} />
            </View>
          </View>
          <Button testID="lab-xfade" title={`Crossfade: ${crossfade}s`} variant="secondary" onPress={() => setCrossfade(crossfade ? 0 : 3)} />
          <Button
            testID="lab-shortlinks"
            title={`Signed links: ${shortLinks ? '90 s (expiry test)' : 'normal'}`}
            variant="secondary"
            onPress={() => setShortLinks(!shortLinks)}
          />
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            {(['class3', 'long30', 'long45'] as Scenario[]).map((s) => (
              <View key={s} style={{ flex: 1 }}>
                <Button testID={`lab-load-${s}`} title={s} onPress={() => void load(s)} />
              </View>
            ))}
          </View>
          <Text variant="caption" muted>
            {info}
          </Text>
        </Card>

        <Card style={{ gap: space.xs }}>
          <Text testID="lab-clock" variant="display">
            {formatClock(sp?.positionSeconds ?? 0)} / {formatClock(totalSeconds)}
          </Text>
          <Text testID="lab-state">State: {sp?.state ?? 'IDLE'}</Text>
          <Text>Track: {sp?.currentTrackIds.map((id) => id.slice(0, 8)).join(' + ') || '-'}</Text>
          <Text>Next cue: {sp?.nextCueKey ?? '-'}</Text>
          <Text>Route: {sp?.route ?? '-'}</Text>
          {sp?.lastError ? <Text style={{ color: colors.danger }}>Error: {sp.lastError}</Text> : null}
        </Card>

        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <View style={{ flex: 1 }}>
            <Button testID="lab-play" title="Play" onPress={() => act('play')} />
          </View>
          <View style={{ flex: 1 }}>
            <Button testID="lab-pause" title="Pause" variant="secondary" onPress={() => act('pause')} />
          </View>
          <View style={{ flex: 1 }}>
            <Button testID="lab-resume" title="Resume" variant="secondary" onPress={() => act('resume')} />
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          {[-10, 10, 60].map((d) => (
            <View key={d} style={{ flex: 1 }}>
              <Button testID={`lab-seek-${d}`} title={`${d > 0 ? '+' : ''}${d}s`} variant="secondary" onPress={() => act('seek', d)} />
            </View>
          ))}
          <View style={{ flex: 1 }}>
            <Button testID="lab-stop" title="Stop" variant="secondary" onPress={() => act('stop')} />
          </View>
        </View>

        <Card style={{ gap: space.xs }}>
          <Text variant="label" muted>
            Measurements
          </Text>
          <Text>Cue lateness (JS-fired, ms): n={stats.n} mean={stats.mean} p50={stats.p50} p95={stats.p95} max={stats.max}</Text>
          <Text muted>Audio-graph cues are scheduled on the audio clock; their timing is read from the device log.</Text>
          <Text muted>Logged events: {events.length}</Text>
        </Card>

        <Card style={{ gap: space.sm }}>
          <Text variant="label" muted>
            Test log
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            {['BT on', 'BT off', 'Locked', 'Unlocked', 'Call', 'Other app', 'Network off', 'Network on', 'Heard cue'].map((m) => (
              <Button key={m} title={m} variant="secondary" onPress={() => record('tester', 'mark', { note: m, position: Number((engine.current?.snapshot().positionSeconds ?? 0).toFixed(3)) })} />
            ))}
          </View>
          <Button
            testID="lab-share"
            title="Share results"
            onPress={() =>
              void Share.share({
                message: exportRun({
                  os: Platform.OS,
                  osVersion: String(Platform.Version),
                  model: Device.modelName ?? null,
                  modelId: Device.modelId ?? null,
                  physicalDevice: Device.isDevice ? 'yes' : 'no',
                  engine: engine.current?.name ?? engineName,
                  test,
                  build: Application.nativeBuildVersion ?? null,
                  version: Application.nativeApplicationVersion ?? null,
                }),
              })
            }
          />
          <Button title="Clear log" variant="ghost" onPress={clearLab} />
        </Card>
        <Button title="Clear lab audio cache" variant="ghost" onPress={() => void clearLabCache()} />
        <Button title="Back" variant="ghost" onPress={() => router.back()} />
      </ScrollView>
    </Screen>
  );
}
